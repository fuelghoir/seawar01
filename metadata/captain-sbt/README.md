# Captain SBT Metadata

The deployed `CaptainSBT` contract builds token metadata URLs as:

```text
baseURI + tokenId
```

That means the uploaded metadata files must be named `1`, `2`, `3`, up to `20`
without a `.json` suffix, unless the contract is changed later.

## Generate

Upload the Captain SBT image first, then run:

```bash
CAPTAIN_SBT_IMAGE_URI=ipfs://CID/captain-sbt.png node scripts/generate-captain-sbt-metadata.mjs
```

Optional:

```bash
CAPTAIN_SBT_EXTERNAL_URL=https://... \
CAPTAIN_SBT_METADATA_DIR=metadata/captain-sbt \
node scripts/generate-captain-sbt-metadata.mjs
```

If `CAPTAIN_SBT_EXTERNAL_URL` is not set, the script uses `NEXT_PUBLIC_URL`.
If neither value exists, `external_url` is omitted from the metadata.

## On-chain update

After uploading the generated metadata folder, call `setBaseURI` on the deployed
`CaptainSBT` contract with the folder URL ending in `/`.

Example:

```text
ipfs://CID/
```

Then token `1` resolves as:

```text
ipfs://CID/1
```
