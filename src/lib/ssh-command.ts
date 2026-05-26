function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildSshTransport(port: number, identityFile?: string): string {
  const identityArg = identityFile ? ` -i ${shellQuote(identityFile)}` : "";
  return `ssh${identityArg} -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
}
