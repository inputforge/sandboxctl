export function buildUserData(pubKey: string, installScript: string): string {
  const scriptLines = installScript
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
  return `#cloud-config
password: ubuntu
chpasswd:
  expire: false
ssh_pwauth: true
ssh_authorized_keys:
  - ${pubKey}

write_files:
  - path: /usr/local/bin/install-tools.sh
    permissions: '0755'
    content: |
${scriptLines}

runcmd:
  - /usr/local/bin/install-tools.sh
`;
}
