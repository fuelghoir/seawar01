# Blockaid Response Draft

Subject: Supporting technical documentation for Sea Battle review

Hi Blockaid Security Team,

Thank you for reviewing our case.

I am attaching a technical security brief for Sea Battle, including the project domain, Base Mainnet contract addresses, transaction flow descriptions, and the approval policy used by the application.

Summary:

- Domain: https://seabattle.top
- Legacy domain still active for existing users: https://seawar01.vercel.app
- Chain: Base Mainnet
- The app uses Base USDC approvals only for explicit user-initiated actions such as wager stakes, challenge entries, and item/NFT purchases.
- The frontend requests exact-amount approvals only. It does not request unlimited approvals.
- The app does not request seed phrases, private keys, or approvals for unrelated tokens.
- Main active Solidity contracts compile without errors or warnings.
- Reward claims do not require user token approvals; they use signed claim data and transfer funded rewards to eligible users.

We believe the flag may have been caused by the recent domain migration from the Vercel subdomain to `seabattle.top` combined with legitimate exact-amount USDC approval flows for gameplay purchases and wagers.

Please let us know if you need any additional documents, screenshots, source-code archive, BaseScan verification links, or transaction examples.

Best regards,

Sea Battle team

