// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20MinerSlots {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface ILegacyFleetPass {
    function fleetStateOf(address player)
        external
        view
        returns (
            uint256 tokenId,
            uint8 tier,
            uint8 level,
            uint256 pointsPerHour,
            uint256 claimablePoints,
            uint256 nextPrice,
            bool maxed
        );
}

/// @title Sea Battle Fleet Miner Slots
/// @notice On-chain extension for miners #2-#10 built on top of the legacy FleetPass NFT.
contract FleetMinerSlots {
    uint8 public constant FIRST_EXTRA_SLOT = 1; // slot 1 is miner #2
    uint8 public constant LAST_EXTRA_SLOT = 9; // slot 9 is miner #10
    uint8 public constant EXTRA_SLOT_COUNT = 9;

    uint256 public constant BPS = 10_000;
    uint256 public constant REWARD_SHARE_BPS = 8_000;
    uint256 public constant DISCOUNT_BPS = 5_000;
    uint256 public constant FIRST_MINER_PRICE = 500_000; // 0.5 USDC

    uint8 public constant DISCOUNT_ACTION_BUY = 1;
    uint8 public constant DISCOUNT_ACTION_UPGRADE = 2;
    uint8 public constant DISCOUNT_ACTION_MAX = 3;
    uint8 public constant DISCOUNT_ACTION_BUY_MAX = 4;

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant DISCOUNT_TYPEHASH =
        keccak256(
            "Discount(address player,uint8 slot,uint8 action,uint256 fullPrice,uint256 nonce,uint256 deadline)"
        );
    bytes32 private constant NAME_HASH = keccak256("Sea Battle Fleet Miner Slots");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant SECP256K1N_DIV_2 =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    struct MinerData {
        uint8 tier;
        uint8 level;
        uint64 lastAccruedAt;
        uint256 bankedPoints;
        uint256 pointSecondRemainder;
        bool exists;
    }

    struct MinerStateView {
        uint8 slot;
        uint8 minerNumber;
        bool owned;
        bool unlocked;
        uint8 tier;
        uint8 level;
        uint256 pointsPerHour;
        uint256 claimablePoints;
        uint256 nextPrice;
        uint256 maxUpgradePrice;
        bool maxed;
    }

    IERC20MinerSlots public immutable usdc;
    ILegacyFleetPass public immutable legacyFleet;

    address public owner;
    address public rewardVault;
    address public treasury;
    address public signerAddress;

    uint256 public rewardFundingTotal;
    uint256 public treasuryFundingTotal;
    bool public purchasesPaused;
    mapping(address => uint256) public discountNonces;
    mapping(uint256 => address) public legacyTokenBoundTo;
    mapping(address => mapping(uint8 => MinerData)) private minerData;

    bool private entered;

    event MinerBought(
        address indexed player,
        uint8 indexed slot,
        uint8 tier,
        uint8 level,
        uint256 paidAmount,
        bool discounted
    );
    event MinerUpgraded(
        address indexed player,
        uint8 indexed slot,
        uint8 previousTier,
        uint8 previousLevel,
        uint8 tier,
        uint8 level,
        uint256 paidAmount,
        bool discounted
    );
    event MinerRestored(
        address indexed player,
        uint8 indexed slot,
        uint8 tier,
        uint8 level,
        uint64 accruedFrom,
        uint256 bankedPoints
    );
    event PassivePointsClaimed(address indexed player, uint8 indexed slot, uint256 points);
    event AllPassivePointsClaimed(address indexed player, uint256 points);
    event RevenueCollected(
        address indexed payer,
        uint256 amount,
        uint256 rewardShare,
        uint256 treasuryShare
    );
    event DiscountUsed(
        address indexed player,
        uint8 indexed slot,
        uint8 indexed action,
        uint256 nonce,
        uint256 fullPrice,
        uint256 paidPrice
    );
    event RewardVaultUpdated(address indexed rewardVault);
    event TreasuryUpdated(address indexed treasury);
    event SignerUpdated(address indexed signerAddress);
    event PurchasesPaused(bool paused);
    event LegacyTokenBound(uint256 indexed tokenId, address indexed player);
    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);

    error NotOwner();
    error ZeroAddress();
    error InvalidSlot();
    error SlotLocked();
    error MinerAlreadyOwned();
    error MinerRequired();
    error MaxEvolution();
    error InvalidEvolution();
    error NoPoints();
    error TransferFailed();
    error ReentrantCall();
    error DiscountExpired();
    error DiscountSignerNotSet();
    error InvalidDiscountSignature();
    error InvalidPointRemainder();
    error InvalidAccrualTimestamp();
    error PurchasesArePaused();
    error LegacyTokenAlreadyBound();

    constructor(
        address usdcAddress,
        address legacyFleetAddress,
        address initialRewardVault,
        address initialTreasury,
        address initialSigner
    ) {
        if (
            usdcAddress == address(0) || legacyFleetAddress == address(0)
                || initialRewardVault == address(0) || initialTreasury == address(0)
        ) revert ZeroAddress();

        owner = msg.sender;
        usdc = IERC20MinerSlots(usdcAddress);
        legacyFleet = ILegacyFleetPass(legacyFleetAddress);
        rewardVault = initialRewardVault;
        treasury = initialTreasury;
        signerAddress = initialSigner;

        emit OwnershipTransferred(address(0), msg.sender);
        emit RewardVaultUpdated(initialRewardVault);
        emit TreasuryUpdated(initialTreasury);
        emit SignerUpdated(initialSigner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    modifier purchasesOpen() {
        if (purchasesPaused) revert PurchasesArePaused();
        _;
    }

    function buyMiner(uint8 slot) external purchasesOpen nonReentrant {
        _buyMiner(msg.sender, slot, FIRST_MINER_PRICE, false, false);
    }

    function buyMinerWithDiscount(uint8 slot, uint256 deadline, bytes calldata signature)
        external
        purchasesOpen
        nonReentrant
    {
        _requireBuyable(msg.sender, slot);
        uint256 paidPrice = _consumeDiscount(
            msg.sender,
            slot,
            DISCOUNT_ACTION_BUY,
            FIRST_MINER_PRICE,
            deadline,
            signature
        );
        _buyMiner(msg.sender, slot, paidPrice, true, false);
    }

    function buyMinerToMax(uint8 slot) external purchasesOpen nonReentrant {
        uint256 paidPrice = fullMinerPrice();
        _buyMiner(msg.sender, slot, paidPrice, false, true);
    }

    function buyMinerToMaxWithDiscount(
        uint8 slot,
        uint256 deadline,
        bytes calldata signature
    ) external purchasesOpen nonReentrant {
        _requireBuyable(msg.sender, slot);
        uint256 fullPrice = fullMinerPrice();
        uint256 paidPrice = _consumeDiscount(
            msg.sender,
            slot,
            DISCOUNT_ACTION_BUY_MAX,
            fullPrice,
            deadline,
            signature
        );
        _buyMiner(msg.sender, slot, paidPrice, true, true);
    }

    function upgradeMiner(uint8 slot) external purchasesOpen nonReentrant {
        MinerData storage data = _ownedMiner(msg.sender, slot);
        (, , uint256 price, bool maxed) = _nextEvolution(data.tier, data.level);
        if (maxed) revert MaxEvolution();
        _upgradeMiner(msg.sender, slot, price, false, false);
    }

    function upgradeMinerWithDiscount(uint8 slot, uint256 deadline, bytes calldata signature)
        external
        purchasesOpen
        nonReentrant
    {
        MinerData storage data = _ownedMiner(msg.sender, slot);
        (, , uint256 fullPrice, bool maxed) = _nextEvolution(data.tier, data.level);
        if (maxed) revert MaxEvolution();
        uint256 paidPrice = _consumeDiscount(
            msg.sender,
            slot,
            DISCOUNT_ACTION_UPGRADE,
            fullPrice,
            deadline,
            signature
        );
        _upgradeMiner(msg.sender, slot, paidPrice, true, false);
    }

    function upgradeMinerToMax(uint8 slot) external purchasesOpen nonReentrant {
        MinerData storage data = _ownedMiner(msg.sender, slot);
        uint256 price = _maxUpgradeCost(data.tier, data.level);
        if (price == 0) revert MaxEvolution();
        _upgradeMiner(msg.sender, slot, price, false, true);
    }

    function upgradeMinerToMaxWithDiscount(
        uint8 slot,
        uint256 deadline,
        bytes calldata signature
    ) external purchasesOpen nonReentrant {
        MinerData storage data = _ownedMiner(msg.sender, slot);
        uint256 fullPrice = _maxUpgradeCost(data.tier, data.level);
        if (fullPrice == 0) revert MaxEvolution();
        uint256 paidPrice = _consumeDiscount(
            msg.sender,
            slot,
            DISCOUNT_ACTION_MAX,
            fullPrice,
            deadline,
            signature
        );
        _upgradeMiner(msg.sender, slot, paidPrice, true, true);
    }

    /// @notice Restores one previously paid slot without charging the player again.
    /// @dev Restore sequentially so each previous slot is maxed before importing the next one.
    function restoreMiner(
        address player,
        uint8 slot,
        uint8 tier,
        uint8 level,
        uint64 accruedFrom,
        uint256 bankedPoints,
        uint256 pointSecondRemainder
    ) external onlyOwner nonReentrant {
        if (player == address(0)) revert ZeroAddress();
        _validateSlot(slot);
        _validateEvolution(tier, level);
        if (minerData[player][slot].exists) revert MinerAlreadyOwned();
        if (!isSlotUnlocked(player, slot)) revert SlotLocked();
        if (pointSecondRemainder >= 3600) revert InvalidPointRemainder();
        if (accruedFrom == 0) accruedFrom = uint64(block.timestamp);
        if (accruedFrom > block.timestamp) revert InvalidAccrualTimestamp();

        if (slot == FIRST_EXTRA_SLOT) _bindLegacyToken(player);

        minerData[player][slot] = MinerData({
            tier: tier,
            level: level,
            lastAccruedAt: accruedFrom,
            bankedPoints: bankedPoints,
            pointSecondRemainder: pointSecondRemainder,
            exists: true
        });

        emit MinerRestored(player, slot, tier, level, accruedFrom, bankedPoints);
    }

    function claimPassivePoints(uint8 slot) external nonReentrant returns (uint256 points) {
        MinerData storage data = _ownedMiner(msg.sender, slot);
        _settle(data);
        points = data.bankedPoints;
        if (points == 0) revert NoPoints();
        data.bankedPoints = 0;
        emit PassivePointsClaimed(msg.sender, slot, points);
    }

    function claimAllPassivePoints() external nonReentrant returns (uint256 points) {
        for (uint8 slot = FIRST_EXTRA_SLOT; slot <= LAST_EXTRA_SLOT; slot++) {
            MinerData storage data = minerData[msg.sender][slot];
            if (!data.exists) continue;
            _settle(data);
            uint256 slotPoints = data.bankedPoints;
            if (slotPoints == 0) continue;
            data.bankedPoints = 0;
            points += slotPoints;
            emit PassivePointsClaimed(msg.sender, slot, slotPoints);
        }
        if (points == 0) revert NoPoints();
        emit AllPassivePointsClaimed(msg.sender, points);
    }

    function minerStateOf(address player, uint8 slot)
        public
        view
        returns (MinerStateView memory state)
    {
        _validateSlot(slot);
        return _minerState(player, slot);
    }

    function allMinerStatesOf(address player)
        external
        view
        returns (MinerStateView[9] memory states)
    {
        for (uint8 index = 0; index < EXTRA_SLOT_COUNT; index++) {
            uint8 slot = index + FIRST_EXTRA_SLOT;
            states[index] = _minerState(player, slot);
        }
    }

    function isSlotUnlocked(address player, uint8 slot) public view returns (bool) {
        _validateSlot(slot);
        if (slot == FIRST_EXTRA_SLOT) {
            uint256 tokenId = _legacyMaxedToken(player);
            address boundPlayer = legacyTokenBoundTo[tokenId];
            return tokenId != 0 && (boundPlayer == address(0) || boundPlayer == player);
        }
        MinerData storage previous = minerData[player][slot - 1];
        return previous.exists && _isMaxed(previous.tier, previous.level);
    }

    function legacyMinerMaxed(address player) public view returns (bool) {
        return _legacyMaxedToken(player) != 0;
    }

    function _legacyMaxedToken(address player) internal view returns (uint256) {
        try legacyFleet.fleetStateOf(player) returns (
            uint256 tokenId,
            uint8 tier,
            uint8 level,
            uint256 ignoredRate,
            uint256 ignoredClaimable,
            uint256 ignoredPrice,
            bool maxed
        ) {
            ignoredRate;
            ignoredClaimable;
            ignoredPrice;
            return tokenId != 0 && (maxed || _isMaxed(tier, level)) ? tokenId : 0;
        } catch {
            return 0;
        }
    }

    function maxUpgradePriceOf(address player, uint8 slot) external view returns (uint256) {
        _validateSlot(slot);
        MinerData storage data = minerData[player][slot];
        if (!data.exists) revert MinerRequired();
        return _maxUpgradeCost(data.tier, data.level);
    }

    function totalClaimablePoints(address player) external view returns (uint256 points) {
        for (uint8 slot = FIRST_EXTRA_SLOT; slot <= LAST_EXTRA_SLOT; slot++) {
            MinerData storage data = minerData[player][slot];
            if (data.exists) points += _claimablePoints(data);
        }
    }

    function totalPointsPerHour(address player) external view returns (uint256 pointsPerHour) {
        for (uint8 slot = FIRST_EXTRA_SLOT; slot <= LAST_EXTRA_SLOT; slot++) {
            MinerData storage data = minerData[player][slot];
            if (data.exists) pointsPerHour += pointRate(data.tier, data.level);
        }
    }

    function pointRate(uint8 tier, uint8 level) public pure returns (uint256) {
        if (tier == 1) {
            if (level == 1) return 50;
            if (level == 2) return 75;
            if (level == 3) return 100;
        }
        if (tier == 2) {
            if (level == 1) return 200;
            if (level == 2) return 250;
            if (level == 3) return 300;
        }
        if (tier == 3) {
            if (level == 1) return 400;
            if (level == 2) return 450;
            if (level == 3) return 500;
        }
        revert InvalidEvolution();
    }

    function nextEvolution(uint8 tier, uint8 level)
        external
        pure
        returns (uint8 nextTier, uint8 nextLevel, uint256 price, bool maxed)
    {
        return _nextEvolution(tier, level);
    }

    function maxUpgradeCost(uint8 tier, uint8 level) external pure returns (uint256) {
        _validateEvolution(tier, level);
        return _maxUpgradeCost(tier, level);
    }

    function fullMinerPrice() public pure returns (uint256) {
        return FIRST_MINER_PRICE + _maxUpgradeCost(1, 1);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function discountDigest(
        address player,
        uint8 slot,
        uint8 action,
        uint256 fullPrice,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(DISCOUNT_TYPEHASH, player, slot, action, fullPrice, nonce, deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function setRewardVault(address nextRewardVault) external onlyOwner {
        if (nextRewardVault == address(0)) revert ZeroAddress();
        rewardVault = nextRewardVault;
        emit RewardVaultUpdated(nextRewardVault);
    }

    function setTreasury(address nextTreasury) external onlyOwner {
        if (nextTreasury == address(0)) revert ZeroAddress();
        treasury = nextTreasury;
        emit TreasuryUpdated(nextTreasury);
    }

    function setSignerAddress(address nextSigner) external onlyOwner {
        signerAddress = nextSigner;
        emit SignerUpdated(nextSigner);
    }

    function setPurchasesPaused(bool paused) external onlyOwner {
        purchasesPaused = paused;
        emit PurchasesPaused(paused);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    function _buyMiner(
        address player,
        uint8 slot,
        uint256 paidPrice,
        bool discounted,
        bool toMax
    ) internal {
        _requireBuyable(player, slot);
        if (slot == FIRST_EXTRA_SLOT) _bindLegacyToken(player);
        _collectRevenue(player, paidPrice);
        uint8 tier = toMax ? 3 : 1;
        uint8 level = toMax ? 3 : 1;
        minerData[player][slot] = MinerData({
            tier: tier,
            level: level,
            lastAccruedAt: uint64(block.timestamp),
            bankedPoints: 0,
            pointSecondRemainder: 0,
            exists: true
        });
        emit MinerBought(player, slot, tier, level, paidPrice, discounted);
    }

    function _upgradeMiner(
        address player,
        uint8 slot,
        uint256 paidPrice,
        bool discounted,
        bool toMax
    ) internal {
        MinerData storage data = _ownedMiner(player, slot);
        _settle(data);
        uint8 previousTier = data.tier;
        uint8 previousLevel = data.level;
        uint8 nextTier;
        uint8 nextLevel;

        if (toMax) {
            if (_isMaxed(previousTier, previousLevel)) revert MaxEvolution();
            nextTier = 3;
            nextLevel = 3;
        } else {
            bool maxed;
            (nextTier, nextLevel,, maxed) = _nextEvolution(previousTier, previousLevel);
            if (maxed) revert MaxEvolution();
        }

        _collectRevenue(player, paidPrice);
        data.tier = nextTier;
        data.level = nextLevel;

        emit MinerUpgraded(
            player,
            slot,
            previousTier,
            previousLevel,
            nextTier,
            nextLevel,
            paidPrice,
            discounted
        );
    }

    function _requireBuyable(address player, uint8 slot) internal view {
        _validateSlot(slot);
        if (minerData[player][slot].exists) revert MinerAlreadyOwned();
        if (!isSlotUnlocked(player, slot)) revert SlotLocked();
    }

    function _bindLegacyToken(address player) internal {
        uint256 tokenId = _legacyMaxedToken(player);
        if (tokenId == 0) revert SlotLocked();
        address boundPlayer = legacyTokenBoundTo[tokenId];
        if (boundPlayer != address(0) && boundPlayer != player) revert LegacyTokenAlreadyBound();
        if (boundPlayer == address(0)) {
            legacyTokenBoundTo[tokenId] = player;
            emit LegacyTokenBound(tokenId, player);
        }
    }

    function _ownedMiner(address player, uint8 slot)
        internal
        view
        returns (MinerData storage data)
    {
        _validateSlot(slot);
        data = minerData[player][slot];
        if (!data.exists) revert MinerRequired();
    }

    function _minerState(address player, uint8 slot)
        internal
        view
        returns (MinerStateView memory state)
    {
        MinerData storage data = minerData[player][slot];
        state.slot = slot;
        state.minerNumber = slot + 1;
        state.owned = data.exists;
        state.unlocked = isSlotUnlocked(player, slot);

        if (!data.exists) {
            state.nextPrice = FIRST_MINER_PRICE;
            return state;
        }

        state.tier = data.tier;
        state.level = data.level;
        state.pointsPerHour = pointRate(data.tier, data.level);
        state.claimablePoints = _claimablePoints(data);
        state.maxed = _isMaxed(data.tier, data.level);
        if (!state.maxed) {
            (,, state.nextPrice,) = _nextEvolution(data.tier, data.level);
            state.maxUpgradePrice = _maxUpgradeCost(data.tier, data.level);
        }
    }

    function _claimablePoints(MinerData storage data) internal view returns (uint256 points) {
        points = data.bankedPoints;
        if (block.timestamp <= data.lastAccruedAt) return points;
        uint256 pointSeconds = data.pointSecondRemainder
            + ((block.timestamp - data.lastAccruedAt) * pointRate(data.tier, data.level));
        return points + (pointSeconds / 3600);
    }

    function _settle(MinerData storage data) internal {
        uint256 elapsed = block.timestamp - data.lastAccruedAt;
        if (elapsed == 0) return;
        uint256 pointSeconds =
            data.pointSecondRemainder + (elapsed * pointRate(data.tier, data.level));
        data.bankedPoints += pointSeconds / 3600;
        data.pointSecondRemainder = pointSeconds % 3600;
        data.lastAccruedAt = uint64(block.timestamp);
    }

    function _collectRevenue(address payer, uint256 amount) internal {
        uint256 rewardShare = (amount * REWARD_SHARE_BPS) / BPS;
        uint256 treasuryShare = amount - rewardShare;
        _safeTransferFrom(payer, rewardVault, rewardShare);
        _safeTransferFrom(payer, treasury, treasuryShare);
        rewardFundingTotal += rewardShare;
        treasuryFundingTotal += treasuryShare;
        emit RevenueCollected(payer, amount, rewardShare, treasuryShare);
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        (bool success, bytes memory returnData) = address(usdc).call(
            abi.encodeWithSelector(IERC20MinerSlots.transferFrom.selector, from, to, amount)
        );
        if (!success || (returnData.length != 0 && !abi.decode(returnData, (bool)))) {
            revert TransferFailed();
        }
    }

    function _consumeDiscount(
        address player,
        uint8 slot,
        uint8 action,
        uint256 fullPrice,
        uint256 deadline,
        bytes calldata signature
    ) internal returns (uint256 paidPrice) {
        if (signerAddress == address(0)) revert DiscountSignerNotSet();
        if (block.timestamp > deadline) revert DiscountExpired();
        uint256 nonce = discountNonces[player];
        bytes32 digest = discountDigest(player, slot, action, fullPrice, nonce, deadline);
        if (_recoverSigner(digest, signature) != signerAddress) revert InvalidDiscountSignature();
        discountNonces[player] = nonce + 1;
        paidPrice = (fullPrice * DISCOUNT_BPS) / BPS;
        emit DiscountUsed(player, slot, action, nonce, fullPrice, paidPrice);
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature)
        internal
        pure
        returns (address recovered)
    {
        if (signature.length != 65) revert InvalidDiscountSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1N_DIV_2) revert InvalidDiscountSignature();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidDiscountSignature();
        recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidDiscountSignature();
    }

    function _maxUpgradeCost(uint8 tier, uint8 level) internal pure returns (uint256 cost) {
        while (!_isMaxed(tier, level)) {
            uint256 price;
            (tier, level, price,) = _nextEvolution(tier, level);
            cost += price;
        }
    }

    function _nextEvolution(uint8 tier, uint8 level)
        internal
        pure
        returns (uint8 nextTier, uint8 nextLevel, uint256 price, bool maxed)
    {
        _validateEvolution(tier, level);
        if (_isMaxed(tier, level)) return (tier, level, 0, true);
        if (level < 3) {
            if (tier == 1) return (tier, level + 1, 300_000, false);
            if (tier == 2) return (tier, level + 1, 2_000_000, false);
            return (tier, level + 1, 5_000_000, false);
        }
        if (tier == 1) return (2, 1, 3_000_000, false);
        if (tier == 2) return (3, 1, 10_000_000, false);
        revert InvalidEvolution();
    }

    function _validateSlot(uint8 slot) internal pure {
        if (slot < FIRST_EXTRA_SLOT || slot > LAST_EXTRA_SLOT) revert InvalidSlot();
    }

    function _validateEvolution(uint8 tier, uint8 level) internal pure {
        if (tier < 1 || tier > 3 || level < 1 || level > 3) revert InvalidEvolution();
    }

    function _isMaxed(uint8 tier, uint8 level) internal pure returns (bool) {
        return tier == 3 && level == 3;
    }
}
