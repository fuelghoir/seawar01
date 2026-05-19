// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title Sea Battle Captain SBT
/// @notice A 20-supply soulbound ERC-721-style pass. Eligibility is checked
///         off-chain by the app signer, then enforced on-chain via EIP-712.
contract CaptainSBT {
    string public constant name = "Sea Battle Captain SBT";
    string public constant symbol = "SBCAPT";
    string public constant version = "1";

    uint256 public constant MAX_SUPPLY = 20;

    address public owner;
    address public signer;
    uint256 public totalSupply;
    string private baseTokenURI;

    mapping(uint256 => address) private owners;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public tokenOfOwner;
    mapping(address => uint256) public nonces;

    bytes32 private constant MINT_TYPEHASH =
        keccak256("Mint(address to,uint256 nonce,uint256 deadline)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event SoulboundMinted(address indexed to, uint256 indexed tokenId);
    event SignerUpdated(address indexed signer);
    event BaseURIUpdated(string baseURI);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error Soulbound();
    error Expired();
    error AlreadyMinted();
    error SoldOut();
    error InvalidSignature();
    error InvalidToken();
    error ZeroAddress();

    constructor(address initialSigner, string memory initialBaseURI) {
        if (initialSigner == address(0)) revert ZeroAddress();
        owner = msg.sender;
        signer = initialSigner;
        baseTokenURI = initialBaseURI;
        emit OwnershipTransferred(address(0), msg.sender);
        emit SignerUpdated(initialSigner);
        emit BaseURIUpdated(initialBaseURI);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function mint(uint256 deadline, bytes calldata signature) external returns (uint256 tokenId) {
        if (block.timestamp > deadline) revert Expired();
        if (balanceOf[msg.sender] != 0) revert AlreadyMinted();
        if (totalSupply >= MAX_SUPPLY) revert SoldOut();

        uint256 nonce = nonces[msg.sender]++;
        bytes32 structHash = keccak256(abi.encode(MINT_TYPEHASH, msg.sender, nonce, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (_recover(digest, signature) != signer) revert InvalidSignature();

        tokenId = totalSupply + 1;
        totalSupply = tokenId;
        owners[tokenId] = msg.sender;
        balanceOf[msg.sender] = 1;
        tokenOfOwner[msg.sender] = tokenId;

        emit Transfer(address(0), msg.sender, tokenId);
        emit SoulboundMinted(msg.sender, tokenId);
    }

    function ownerOf(uint256 tokenId) public view returns (address tokenOwner) {
        tokenOwner = owners[tokenId];
        if (tokenOwner == address(0)) revert InvalidToken();
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return string.concat(baseTokenURI, _toString(tokenId));
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

    function setBaseURI(string calldata nextBaseURI) external onlyOwner {
        baseTokenURI = nextBaseURI;
        emit BaseURIUpdated(nextBaseURI);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f;   // ERC-721 metadata
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
