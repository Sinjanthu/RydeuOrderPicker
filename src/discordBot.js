import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { isAutoAcceptEnabled, setAutoAccept } from './autoAcceptState.js';
import { loadRules, updateRules } from './autoAcceptRules.js';

// Persistent process, separate from the poller (index.js/poll.js) -
// registers and listens for a single slash command that flips
// auto-accept-state.json, which the poller reads fresh on every check
// (see autoAcceptState.js). Meant to run alongside the poller on the VPS
// via PM2, not as part of the same process, matching this VPS's existing
// convention of one PM2 process per concern.

const COMMAND_NAME = 'auto-accept-rydeu';
const RULES_COMMAND_NAME = 'rydeu-rules';

const command = new SlashCommandBuilder()
  .setName(COMMAND_NAME)
  .setDescription('Toggle automatic Rydeu auction accepting on/off');

const rulesCommand = new SlashCommandBuilder()
  .setName(RULES_COMMAND_NAME)
  .setDescription('View or edit the auto-accept rules')
  .addSubcommand((sub) => sub.setName('view').setDescription('Show current auto-accept rules'))
  .addSubcommand((sub) => sub
    .setName('set')
    .setDescription('Update one or more rules (only the options you pass are changed)')
    .addStringOption((opt) => opt.setName('blackout_start').setDescription('Blackout window start, 24h HH:MM, Stockholm time (e.g. 23:00)'))
    .addStringOption((opt) => opt.setName('blackout_end').setDescription('Blackout window end, 24h HH:MM, Stockholm time (e.g. 07:00)'))
    .addNumberOption((opt) => opt.setName('arlanda_min_price').setDescription('Only auto-accept Arlanda pickups priced above this (EUR)')));

async function registerCommands(token, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);
  const app = await rest.get(Routes.oauth2CurrentApplication());
  // Guild-scoped registration (not global) - takes effect instantly rather
  // than global commands' up-to-1hr propagation delay, fine for a single-
  // server bot.
  await rest.put(Routes.applicationGuildCommands(app.id, guildId), { body: [command.toJSON(), rulesCommand.toJSON()] });
  console.log(`✓ /${COMMAND_NAME} and /${RULES_COMMAND_NAME} registered for guild ${guildId}`);
}

function formatRulesMessage(rules) {
  return [
    '**Current auto-accept rules** (checked in this order):',
    `1. Blackout window: **${rules.blackoutStart}-${rules.blackoutEnd}** (Stockholm time) - nothing auto-accepted during this window`,
    `2. Arlanda pickup → auto-accept only if price **> €${rules.arlandaMinPrice}**`,
    '3. Any other pickup → auto-accept immediately',
    !rules.firstAuctionStudied
      ? '\n⚠️ One-time bypass still armed: the very next auction will be attempted regardless of all of the above, to get one real recording of the flow.'
      : '',
  ].filter(Boolean).join('\n');
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) {
    throw new Error('DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set in .env');
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === COMMAND_NAME) {
      const newState = !isAutoAcceptEnabled();
      setAutoAccept(newState);
      console.log(`Auto-accept toggled to ${newState} by ${interaction.user.tag}`);
      await interaction.reply(
        newState
          ? '🤖 Rydeu auto-accept is now **ON** - new auctions will trigger a best-effort accept attempt (unverified flow - check the recording each time), subject to /rydeu-rules.'
          : '🤖 Rydeu auto-accept is now **OFF** - back to notify-only.',
      );
      return;
    }

    if (interaction.commandName === RULES_COMMAND_NAME) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'view') {
        await interaction.reply(formatRulesMessage(loadRules()));
        return;
      }

      // sub === 'set'
      const blackoutStart = interaction.options.getString('blackout_start');
      const blackoutEnd = interaction.options.getString('blackout_end');
      const arlandaMinPrice = interaction.options.getNumber('arlanda_min_price');

      for (const [label, val] of [['blackout_start', blackoutStart], ['blackout_end', blackoutEnd]]) {
        if (val !== null && !HHMM_RE.test(val)) {
          await interaction.reply(`⚠️ \`${label}\` must be 24h HH:MM (e.g. \`23:00\`), got \`${val}\`. Nothing changed.`);
          return;
        }
      }
      if (arlandaMinPrice !== null && arlandaMinPrice < 0) {
        await interaction.reply(`⚠️ \`arlanda_min_price\` can't be negative. Nothing changed.`);
        return;
      }

      const patch = {};
      if (blackoutStart !== null) patch.blackoutStart = blackoutStart;
      if (blackoutEnd !== null) patch.blackoutEnd = blackoutEnd;
      if (arlandaMinPrice !== null) patch.arlandaMinPrice = arlandaMinPrice;

      if (Object.keys(patch).length === 0) {
        await interaction.reply('⚠️ No options given - nothing changed. ' + formatRulesMessage(loadRules()));
        return;
      }

      const rules = updateRules(patch);
      console.log(`Rules updated by ${interaction.user.tag}: ${JSON.stringify(patch)}`);
      await interaction.reply('✓ Rules updated.\n' + formatRulesMessage(rules));
    }
  });

  client.once('clientReady', () => {
    console.log(`✓ Discord bot logged in as ${client.user.tag}`);
  });

  await registerCommands(token, guildId);
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
