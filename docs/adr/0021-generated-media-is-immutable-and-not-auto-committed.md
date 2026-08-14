# Generated media is immutable and not auto-committed

Every generated media result is an immutable Asset Attempt named by stable identity and content hash, while selection and current-deliverable pointers remain small textual records. Workspace text is Git-friendly, but large media is not committed automatically; manifests make missing blobs detectable and leave remote media storage and backup as an explicit later policy instead of silently bloating repositories.
