# Security

Imprint processes source code and can invoke models. Treat repositories, generated representations, and model output as untrusted.

- Never place repository or provider credentials in an Imprint release.
- Bind every release to an immutable repository identity and commit.
- Do not activate a release whose source digest or proof does not verify.
- Keep private repository endpoints behind Cloudflare Access.

Report vulnerabilities privately to jcoeyman@cloudflare.com.
