// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title Sea Battle Signature Drop Claim
/// @notice ERC20/native-token claim contract. Allocations are calculated
///         off-chain, signed by the app signer, and claimed by users on-chain.
contract SignatureDropClaim {
    string public constant name = "Sea Battle Drop Claim";
    string public constant version = "1";

    address public owner;
    address public signer;
    mapping(bytes32 => mapping(address => bool)) public claimed;

    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 dropId,address token,address account,uint256 amount,uint256 deadline)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    event Claimed(bytes32 indexed dropId, address indexed account, address indexed token, uint256 amount);
    event SignerUpdated(address indexed signer);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error ZeroAddress();
    error Expired();
    error AlreadyClaimed();
    error InvalidSignature();
    error TransferFailed();

    constructor(address initialSigner) {
        if (initialSigner == address(0)) revert ZeroAddress();
        owner = msg.sender;
        signer = initialSigner;
        emit OwnershipTransferred(address(0), msg.sender);
        emit SignerUpdated(initialSigner);
    }

    receive() external payable {}

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function claim(
        bytes32 dropId,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert Expired();
        if (claimed[dropId][msg.sender]) revert AlreadyClaimed();

        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, dropId, token, msg.sender, amount, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        if (_recover(digest, signature) != signer) revert InvalidSignature();

        claimed[dropId][msg.sender] = true;
        _payout(token, msg.sender, amount);
        emit Claimed(dropId, msg.sender, token, amount);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(this)
            )
        );
    }

    function setSigner(address nextSigner) external onlyOwner {
        if (nextSigner == address(0)) revert ZeroAddress();
        signer = nextSigner;
        emit SignerUpdated(nextSigner);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        _payout(token, to, amount);
        emit Withdrawn(token, to, amount);
    }

    function _payout(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
            return;
        }

        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Like.transfer.selector, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered;
    }
}
