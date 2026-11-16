# Editing credentials and saving small files

Unlock the vault, open a credential's three-dot menu and choose **Edit**, or open
the detail view and choose **Edit Credential**. Change its details, rename or edit
fields, use **Add Field**, and remove optional fields with the trash button.
**Save** updates the same record. **Cancel** discards the local edits.

Secret masking is saved with the field and remains enabled when it is renamed.
Use **Secret** to change masking explicitly. A template's required fields are
marked **Required** and cannot be removed or saved empty. Older records have no
stored required flags, so their existing fields are treated as optional.

For a file, add a field, give it a unique name, choose **File**, and select the
file. Existing records can gain file fields without being recreated. Google OAuth
and Google Service Account templates also include optional JSON file fields.
Save the credential, reopen it, and choose **Download** beside the file. The
confirmation explains that this creates a decrypted copy on your device.

Limits: **128 KiB per file**, **five files per credential**, **256 KiB total file
bytes per credential**, and **50 fields**. These are small file fields intended
for OAuth JSON and key files. Files retain their original bytes, including binary
content; the app does not preview, execute or interpret them.

File contents, names, exact lengths and field settings are encrypted in the browser
with the credential. The server receives only the signed ciphertext. Existing
encrypted credential backups include these file fields and restore them with the
rest of the record; the **32 MiB backup file limit** still applies. Template exports
contain definitions only and do not contain credential files or values.

If another tab changed the record, saving reports a conflict and keeps your edits
visible. Copy any changes you need, reopen the latest record, and apply them there.
Locking, signing out or closing the editor discards the local plaintext. If a save
was already sent, reopen the record to check its result; cancellation cannot undo a
request the server already accepted. New saves also reserve space under the import
batch limit, rejecting ciphertext above 880,000 characters before sending.
Removing a field/file does not erase copies in backups you already downloaded.

Reload the application after upgrading. The broader 10 MiB standalone attachment,
collection and ZIP backup system in PLAN-004 is still planned separately.
