if (process.argv[2] === "--github-mcp") {
  const { serveGithub } = await import("./github-mcp.mjs");
  await serveGithub(...process.argv.slice(3));
} else {
  await import("./worker.mjs");
}
