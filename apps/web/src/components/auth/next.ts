/** Only same-site paths are honoured as a post-login destination. */
export const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/dashboard");
