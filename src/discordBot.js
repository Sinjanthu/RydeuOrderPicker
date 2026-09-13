import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { isAutoAcceptEnabled, setAutoAccept } from './autoAcceptState.js';

// Persistent process, separate from the poller (index.js/poll.js) -
// registers and listens for a single slash command that flips
// auto-accept-state.json, which the poller reads fresh on every check
// (see autoAcceptState.js). Meant to run alongside the poller on the VPS
// via PM2, not as part of the same process, matching this VPS's existing
// convention of one PM2 process per concern.

const COMMAND_NAME = 'auto-accept-rydeu';

const command = new SlashCommandBuilder()
  .setName(COMMAND_NAME)
  .setDescription('Toggle automatic Rydeu auction accepting on/off');

async function registerCommand(token, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);
  const app = await rest.get(Routes.oauth2CurrentApplication());
  // Guild-scoped registration (not global) - takes effect instantly rather
  // than global commands' up-to-1hr propagation delay, fine for a single-
  // server bot.
  await rest.put(Routes.applicationGuildCommands(app.id, guildId), { body: [command.toJSON()] });
  console.log(`✓ /${COMMAND_NAME} registered for guild ${guildId}`);
}

export async function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) {
    throw new Error('DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set in .env');
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== COMMAND_NAME) return;

    const newState = !isAutoAcceptEnabled();
    setAutoAccept(newState);
    console.log(`Auto-accept toggled to ${newState} by ${interaction.user.tag}`);
    await interaction.reply(
      newState
        ? '🤖 Rydeu auto-accept is now **ON** - new auctions will trigger a best-effort accept attempt (unverified flow - check the recording each time).'
        : '🤖 Rydeu auto-accept is now **OFF** - back to notify-only.',
    );
  });

  client.once('clientReady', () => {
    console.log(`✓ Discord bot logged in as ${client.user.tag}`);
  });

  await registerCommand(token, guildId);
  await client.login(token);
  return client;
}

// Always the main entry point (unlike the other src/*.js files, this isn't
// meant to be imported as a library) - no import.meta.url guard needed, and
// deliberately none used: PM2's fork_mode invokes this script in a way
// where process.argv[1] doesn't match what `node script.js` sets directly,
// silently failing that guard and never actually starting the bot (it just
// sits "online" forever, kept alive by PM2's own IPC channel, producing
// zero output) - cost real time to track down, see git history.
startDiscordBot().catch((err) => {
  console.error('❌ Discord bot failed to start:', err.message);
  process.exit(1);
});
