import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../../.env' });

export interface DiscordAttachment {
  url: string;
  type: 'image' | 'video' | 'audio' | 'document';
  name: string;
}

type MessageHandler = (author: string, content: string, channelId: string, attachments: DiscordAttachment[]) => void;

let discordClient: Client | null = null;
let messageHandler: MessageHandler | null = null;

// Deduplication: prevent processing the same message twice
const processedMessages = new Set<string>();
const MAX_PROCESSED = 500;

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

    // Deduplicate: skip if already processed
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    if (processedMessages.size > MAX_PROCESSED) {
      const first = processedMessages.values().next().value;
      if (first) processedMessages.delete(first);
    }

    const author = message.author.displayName || message.author.username;
    const content = message.content;
    const channelId = message.channelId;

    // Parse attachments (images, videos, audio, documents)
    const attachments: DiscordAttachment[] = message.attachments.map(att => {
      const ct = att.contentType ?? '';
      let type: DiscordAttachment['type'] = 'document';
      if (ct.startsWith('image/')) type = 'image';
      else if (ct.startsWith('video/')) type = 'video';
      else if (ct.startsWith('audio/')) type = 'audio';
      return { url: att.url, type, name: att.name ?? att.id };
    });

    // Guard: if content is empty and no attachments, MessageContent intent is likely disabled
    if (!content && attachments.length === 0) {
      console.warn(`[Discord] ⚠️ Mensagem de ${author} chegou com content vazio e sem anexos. Verifique se o "Message Content Intent" está ativo no Developer Portal.`);
      return;
    }

    console.log(`[Discord] Message from ${author}: ${content.slice(0, 80)}${attachments.length ? ` [+${attachments.length} arquivo(s)]` : ''}`);

    if (messageHandler) {
      messageHandler(author, content, channelId, attachments);
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
