import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../../.env' });

type MessageHandler = (author: string, content: string, channelId: string) => void;

let discordClient: Client | null = null;
let messageHandler: MessageHandler | null = null;

export async function initDiscord(onMessage: MessageHandler): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn('DISCORD_BOT_TOKEN not set, Discord integration disabled');
    return false;
  }

  messageHandler = onMessage;

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageTyping,
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.User,
    ],
  });

  discordClient.on(Events.MessageCreate, (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    const author = message.author.displayName || message.author.username;
    const content = message.content;
    const channelId = message.channelId;

    console.log(`[Discord] Message from ${author}: ${content.slice(0, 80)}`);

    if (messageHandler) {
      messageHandler(author, content, channelId);
    }
  });

  discordClient.on(Events.ClientReady, (c) => {
    console.log(`[Discord] Bot logged in as ${c.user.tag}`);
  });

  try {
    await discordClient.login(token);
    return true;
  } catch (error) {
    console.error('[Discord] Login failed:', error);
    return false;
  }
}

export async function sendDiscordMessage(channelId: string, content: string): Promise<boolean> {
  if (!discordClient) return false;

  try {
    const channel = await discordClient.channels.fetch(channelId);
    if (channel && channel.isTextBased() && 'send' in channel) {
      await channel.send(content);
      return true;
    }
  } catch (error) {
    console.error('[Discord] Send message failed:', error);
  }
  return false;
}

export function getDiscordClient(): Client | null {
  return discordClient;
}
