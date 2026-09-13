// PM2 process definitions for the VPS deployment. Two separate processes,
// matching this VPS's existing convention (one PM2 process per concern)
// rather than bundling the poller and the Discord command listener
// together - they only need to agree on the filesystem
// (auto-accept-state.json), not share a process.
module.exports = {
  apps: [
    {
      name: 'rydeu-auction-poller',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
    },
    {
      name: 'rydeu-discord-bot',
      script: 'src/discordBot.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
    },
  ],
};
