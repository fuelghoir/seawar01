// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20Fleet {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721ReceiverFleet {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @title Sea Battle Fleet Pass
/// @notice Transferable evolving ERC-721 fleet NFTs with passive claimable game points.
contract FleetPassNFT_V2 {
    string public constant name = "Sea Battle Fleet Pass";
    string public constant symbol = "SBFLEET";

    uint256 public constant BPS = 10_000;
    uint256 public constant SEASON_SHARE_BPS = 8_000;
    uint256 public constant FIRST_NFT_PRICE = 500_000; // 0.5 USDC

    address public owner;
    address public rewardVault;
    IERC20Fleet public immutable usdc;
    uint256 public nextTokenId = 1;
    uint256 public seasonFundingTotal;
    string private baseTokenURI;
    bool private entered;
    
    address public signerAddress;
    mapping(bytes => bool) public usedSignatures;

    struct FleetData {
        uint8 tier;
        uint8 level;
        uint64 lastAccruedAt;
        uint256 bankedPoints;
        uint256 pointSecondRemainder;
    }

    mapping(uint256 => address) private owners;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) private tokenApprovals;
    mapping(address => mapping(address => bool)) private operatorApprovals;
    mapping(address => uint256) public activeTokenOf;
    mapping(uint256 => FleetData) public fleetData;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event FleetMinted(address indexed player, uint256 indexed tokenId, uint8 tier, uint8 level);
    event FleetBurned(address indexed player, uint256 indexed tokenId, uint8 tier, uint8 level);
    event FleetEvolved(address indexed player, uint256 indexed previousTokenId, uint256 indexed tokenId, uint8 tier, uint8 level);
    event PassivePointsClaimed(address indexed player, uint256 indexed tokenId, uint256 points);
    event SeasonRevenueFunded(address indexed payer, uint256 amount);
    event RewardVaultUpdated(address indexed rewardVault);
    event BaseURIUpdated(string baseURI);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error AlreadyOwnsFleet();
    error FleetRequired();
    error NotAuthorized();
    error InvalidToken();
    error MaxEvolution();
    error NoPoints();
    error TransferFailed();
    error UnsafeRecipient();
    error ReentrantCall();
    error InvalidSignature();
    error SignatureAlreadyUsed();

    constructor(address usdcAddress, address initialRewardVault, string memory initialBaseURI) {
        if (usdcAddress == address(0) || initialRewardVault == address(0)) revert ZeroAddress();
        owner = msg.sender;
        usdc = IERC20Fleet(usdcAddress);
        rewardVault = initialRewardVault;
        baseTokenURI = initialBaseURI;
        emit OwnershipTransferred(address(0), msg.sender);
        emit RewardVaultUpdated(initialRewardVault);
        emit BaseURIUpdated(initialBaseURI);
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

    function setSignerAddress(address nextSigner) external onlyOwner {
        signerAddress = nextSigner;
    }

    function _recoverSigner(bytes32 ethSignedMessageHash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        return ecrecover(ethSignedMessageHash, v, r, s);
    }

    function buyFleetNft() external nonReentrant returns (uint256 tokenId) {
        if (activeTokenOf[msg.sender] != 0) revert AlreadyOwnsFleet();
        _collectRevenue(msg.sender, FIRST_NFT_PRICE);
        tokenId = _mintFleet(msg.sender, 1, 1, 0, 0);
    }

    function buyFleetNftWithDiscount(bytes calldata signature) external nonReentrant returns (uint256 tokenId) {
        if (activeTokenOf[msg.sender] != 0) revert AlreadyOwnsFleet();
        if (signerAddress == address(0)) revert InvalidSignature();

        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, "discount_buy"));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        address recoveredSigner = _recoverSigner(ethSignedMessageHash, signature);
        if (recoveredSigner != signerAddress) revert InvalidSignature();
        if (usedSignatures[signature]) revert SignatureAlreadyUsed();
        
        usedSignatures[signature] = true;
        
        _collectRevenue(msg.sender, FIRST_NFT_PRICE / 2);
        tokenId = _mintFleet(msg.sender, 1, 1, 0, 0);
    }

    function migrateFleetNft(uint8 tier, uint8 level, bytes calldata signature) external nonReentrant returns (uint256 tokenId) {
        if (activeTokenOf[msg.sender] != 0) revert AlreadyOwnsFleet();
        if (hasMigrated[msg.sender]) revert NotAuthorized();
        if (signerAddress == address(0)) revert InvalidSignature();

        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, tier, level, "MIGRATE"));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        address recoveredSigner = _recoverSigner(ethSignedMessageHash, signature);
        if (recoveredSigner != signerAddress) revert InvalidSignature();

        hasMigrated[msg.sender] = true;
        tokenId = _mintFleet(msg.sender, tier, level, 0, 0);
    }

    function upgradeFleetNft() external nonReentrant returns (uint256 tokenId) {
        uint256 previousTokenId = activeTokenOf[msg.sender];
        if (previousTokenId == 0) revert FleetRequired();
        if (owners[previousTokenId] != msg.sender) revert NotAuthorized();

        _settle(previousTokenId);
        FleetData memory previous = fleetData[previousTokenId];
        (uint8 nextTier, uint8 nextLevel, uint256 price, bool maxed) =
            _nextEvolution(previous.tier, previous.level);
        if (maxed) revert MaxEvolution();

        _collectRevenue(msg.sender, price);
        _burnFleet(previousTokenId);
        tokenId = _mintFleet(
            msg.sender,
            nextTier,
            nextLevel,
            previous.bankedPoints,
            previous.pointSecondRemainder
        );
        emit FleetEvolved(msg.sender, previousTokenId, tokenId, nextTier, nextLevel);
    }

    function upgradeToMaxLevel() external nonReentrant returns (uint256 tokenId) {
        uint256 previousTokenId = activeTokenOf[msg.sender];
        if (previousTokenId == 0) revert FleetRequired();
        if (owners[previousTokenId] != msg.sender) revert NotAuthorized();

        _settle(previousTokenId);
        FleetData memory previous = fleetData[previousTokenId];
        if (previous.tier == 3 && previous.level == 3) revert MaxEvolution();

        uint256 totalCost = 0;
        uint8 currentTier = previous.tier;
        uint8 currentLevel = previous.level;

        while (currentTier < 3 || currentLevel < 3) {
            (uint8 nextTier, uint8 nextLevel, uint256 price, ) = _nextEvolution(currentTier, currentLevel);
            totalCost += price;
            currentTier = nextTier;
            currentLevel = nextLevel;
        }

        _collectRevenue(msg.sender, totalCost);
        _burnFleet(previousTokenId);
        tokenId = _mintFleet(
            msg.sender,
            3,
            3,
            previous.bankedPoints,
            previous.pointSecondRemainder
        );
        emit FleetEvolved(msg.sender, previousTokenId, tokenId, 3, 3);
    }

    function claimPassivePoints() external nonReentrant returns (uint256 points) {
        uint256 tokenId = activeTokenOf[msg.sender];
        if (tokenId == 0) revert FleetRequired();
        _settle(tokenId);
        points = fleetData[tokenId].bankedPoints;
        if (points == 0) revert NoPoints();
        fleetData[tokenId].bankedPoints = 0;
        emit PassivePointsClaimed(msg.sender, tokenId, points);
    }

    /// @notice One-call state for a fast shop render.
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
        )
    {
        tokenId = activeTokenOf[player];
        if (tokenId == 0) {
            return (0, 0, 0, 0, 0, FIRST_NFT_PRICE, false);
        }

        FleetData storage data = fleetData[tokenId];
        tier = data.tier;
        level = data.level;
        pointsPerHour = pointRate(tier, level);
        claimablePoints = data.bankedPoints;
        if (block.timestamp > data.lastAccruedAt) {
            uint256 pointSeconds =
                data.pointSecondRemainder + ((block.timestamp - data.lastAccruedAt) * pointsPerHour);
            claimablePoints += pointSeconds / 3600;
        }
        (, , nextPrice, maxed) = _nextEvolution(tier, level);
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
        revert InvalidToken();
    }

    function ownerOf(uint256 tokenId) public view returns (address tokenOwner) {
        tokenOwner = owners[tokenId];
        if (tokenOwner == address(0)) revert InvalidToken();
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        FleetData storage data = fleetData[tokenId];
        uint256 variant = ((uint256(data.tier) - 1) * 3) + uint256(data.level);
        return string.concat(baseTokenURI, _toString(variant), ".json");
    }

    function approve(address approved, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        if (msg.sender != tokenOwner && !operatorApprovals[tokenOwner][msg.sender]) revert NotAuthorized();
        tokenApprovals[tokenId] = approved;
        emit Approval(tokenOwner, approved, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address tokenOwner, address operator) external view returns (bool) {
        return operatorApprovals[tokenOwner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (!_isApprovedOrOwner(msg.sender, tokenId)) revert NotAuthorized();
        if (owners[tokenId] != from) revert NotAuthorized();
        if (to == address(0)) revert ZeroAddress();

        delete tokenApprovals[tokenId];
        if (from == to) {
            emit Transfer(from, to, tokenId);
            return;
        }
        if (activeTokenOf[to] != 0) revert AlreadyOwnsFleet();

        _settle(tokenId);
        owners[tokenId] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        activeTokenOf[from] = 0;
        activeTokenOf[to] = tokenId;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (
            to.code.length != 0
                && IERC721ReceiverFleet(to).onERC721Received(msg.sender, from, tokenId, data)
                    != IERC721ReceiverFleet.onERC721Received.selector
        ) revert UnsafeRecipient();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f; // ERC-721 metadata
    }

    function setRewardVault(address nextRewardVault) external onlyOwner {
        if (nextRewardVault == address(0)) revert ZeroAddress();
        rewardVault = nextRewardVault;
        emit RewardVaultUpdated(nextRewardVault);
    }

    function setBaseURI(string calldata nextBaseURI) external onlyOwner {
        baseTokenURI = nextBaseURI;
        emit BaseURIUpdated(nextBaseURI);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    function _collectRevenue(address payer, uint256 amount) internal {
        uint256 seasonShare = (amount * SEASON_SHARE_BPS) / BPS;
        uint256 ownerShare = amount - seasonShare;
        if (!usdc.transferFrom(payer, rewardVault, seasonShare)) revert TransferFailed();
        if (!usdc.transferFrom(payer, owner, ownerShare)) revert TransferFailed();
        seasonFundingTotal += seasonShare;
        emit SeasonRevenueFunded(payer, seasonShare);
    }

    function _mintFleet(
        address to,
        uint8 tier,
        uint8 level,
        uint256 bankedPoints,
        uint256 pointSecondRemainder
    ) internal returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (activeTokenOf[to] != 0) revert AlreadyOwnsFleet();

        tokenId = nextTokenId++;
        owners[tokenId] = to;
        balanceOf[to] += 1;
        activeTokenOf[to] = tokenId;
        fleetData[tokenId] = FleetData({
            tier: tier,
            level: level,
            lastAccruedAt: uint64(block.timestamp),
            bankedPoints: bankedPoints,
            pointSecondRemainder: pointSecondRemainder
        });
        emit Transfer(address(0), to, tokenId);
        emit FleetMinted(to, tokenId, tier, level);
    }

    function _burnFleet(uint256 tokenId) internal {
        address tokenOwner = ownerOf(tokenId);
        FleetData memory data = fleetData[tokenId];
        delete tokenApprovals[tokenId];
        delete owners[tokenId];
        delete fleetData[tokenId];
        balanceOf[tokenOwner] -= 1;
        activeTokenOf[tokenOwner] = 0;
        emit Transfer(tokenOwner, address(0), tokenId);
        emit FleetBurned(tokenOwner, tokenId, data.tier, data.level);
    }

    function _settle(uint256 tokenId) internal {
        FleetData storage data = fleetData[tokenId];
        uint256 elapsed = block.timestamp - data.lastAccruedAt;
        if (elapsed == 0) return;
        uint256 pointSeconds = data.pointSecondRemainder + (elapsed * pointRate(data.tier, data.level));
        data.bankedPoints += pointSeconds / 3600;
        data.pointSecondRemainder = pointSeconds % 3600;
        data.lastAccruedAt = uint64(block.timestamp);
    }

    function _nextEvolution(uint8 tier, uint8 level)
        internal
        pure
        returns (uint8 nextTier, uint8 nextLevel, uint256 price, bool maxed)
    {
        if (tier == 3 && level == 3) return (tier, level, 0, true);
        if (level < 3) {
            if (tier == 1) return (tier, level + 1, 300_000, false);
            if (tier == 2) return (tier, level + 1, 2_000_000, false);
            if (tier == 3) return (tier, level + 1, 5_000_000, false);
        }
        if (tier == 1 && level == 3) return (2, 1, 3_000_000, false);
        if (tier == 2 && level == 3) return (3, 1, 10_000_000, false);
        revert InvalidToken();
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address tokenOwner = ownerOf(tokenId);
        return spender == tokenOwner || tokenApprovals[tokenId] == spender || operatorApprovals[tokenOwner][spender];
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
