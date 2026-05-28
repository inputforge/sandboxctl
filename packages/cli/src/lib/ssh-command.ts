function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

interface SshTransportOptions {
  disableHostKeyVerification?: boolean;
  identityFile?: string;
  port: number;
}

export function buildSshTransport({
  disableHostKeyVerification = false,
  identityFile,
  port,
}: SshTransportOptions): string {
  const identityArg = identityFile ? ` -i ${shellQuote(identityFile)}` : "";
  const hostKeyArgs = disableHostKeyVerification
    ? " -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
    : "";
  return `ssh${identityArg} -p ${port}${hostKeyArgs}`;
}
