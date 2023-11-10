import {
  Client,
  Intents,
  MessageEmbed,
  MessageActionRow,
  MessageButton,
} from "discord.js";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MEMBERS,
  ],
});

const REST_API_URL = process.env.REST_API_URL;
const UPDATE_API_URL = process.env.UPDATE_API_URL;
const CHANNEL_ID = process.env.CHANNEL_ID;
const APPROVED_CHANNEL_ID = process.env.APPROVED_CHANNEL_ID;
const REJECTED_CHANNEL_ID = process.env.REJECTED_CHANNEL_ID;
let lastFormTime = "";

async function fetchFromWordPressAPI(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status} for URL: ${url}`);
  }
  return response.json();
}

async function initializeLastFormTime() {
  const submissions = await fetchFromWordPressAPI(REST_API_URL);
  if (submissions && submissions.length > 0) {
    lastFormTime = submissions[0].time;
  }
}

async function checkForNewSubmission() {
  const submissions = await fetchFromWordPressAPI(REST_API_URL);
  for (const submission of submissions) {
    if (new Date(submission.time) > new Date(lastFormTime)) {
      lastFormTime = submission.time;
      sendToDiscord(submission);
    }
  }
}

function sendToDiscord(submission) {
  const fields = Object.keys(submission)
    .filter((key) => key !== "status")
    .map((key) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value: String(submission[key]),
      inline: false,
    }));

  const color = submission.status === "approved" ? "#57F287" : "#1F8B4C";
  const statusEmoji = submission.status === "approved" ? "🟩" : "🔴";

  const embed = new MessageEmbed()
    .setTitle("New Form Submission")
    .setColor(color)
    .addFields(fields)
    .setTimestamp(new Date(submission.time))
    .setFooter({ text: "LIDOMA BOT" });

  if (["approved", "rejected"].includes(submission.status)) {
    embed.addField(
      "Status",
      `${statusEmoji} ${submission.status.toUpperCase()}`,
    );
  }

  const row = new MessageActionRow().addComponents(
    new MessageButton()
      .setCustomId("approve_" + submission.id)
      .setLabel("Approve")
      .setStyle("SUCCESS"),
    new MessageButton()
      .setCustomId("reject_" + submission.id)
      .setLabel("Reject")
      .setStyle("DANGER"),
  );

  const channel = client.channels.cache.get(CHANNEL_ID);
  channel?.send({ embeds: [embed], components: [row] });
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  initializeLastFormTime().then(() => {
    setInterval(checkForNewSubmission, 10000);
  });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, submissionId] = interaction.customId.split("_");
  const originalMessage = interaction.message;

  const usernameField = originalMessage.embeds[0].fields.find(
    (field) => field.name === "Username",
  );
  const teamNameField = originalMessage.embeds[0].fields.find(
    (field) => field.name === "Team_name",
  );

  if (!usernameField || !teamNameField) {
    await interaction.reply({
      content: "Required fields not found in the message.",
      ephemeral: true,
    });
    return;
  }

  const username = usernameField.value;
  const teamName = teamNameField.value;

  try {
    if (action === "approve") {
      await updateSubmissionStatus(submissionId, "approved");
      await moveAndEditMessage(
        originalMessage,
        APPROVED_CHANNEL_ID,
        "Approved",
      );

      const [name, discriminator] = username.includes("#")
        ? username.split("#")
        : [username, null];

      const member = interaction.guild.members.cache.find((m) =>
        discriminator
          ? m.user.username === name && m.user.discriminator === discriminator
          : m.user.username === name,
      );

      if (member) {
        let role = interaction.guild.roles.cache.find(
          (r) => r.name === teamName,
        );
        if (!role) {
          role = await interaction.guild.roles.create({
            name: teamName,
            //color: "BLUE",
          });
        }

        await member.roles.add(role);

        let category = interaction.guild.channels.cache.find(
          (c) => c.name === teamName && c.type === "GUILD_CATEGORY",
        );
        if (!category) {
          category = await interaction.guild.channels.create(teamName, {
            type: "GUILD_CATEGORY",
            permissionOverwrites: [
              {
                id: role.id,
                allow: ["VIEW_CHANNEL"],
              },
              {
                id: interaction.guild.roles.everyone,
                deny: ["VIEW_CHANNEL"],
              },
            ],
          });
        }

        const textChannel = await interaction.guild.channels.create(
          `${teamName}-text`,
          {
            type: "GUILD_TEXT",
            parent: category.id,
          },
        );

        const voiceChannel = await interaction.guild.channels.create(
          `${teamName}-voice`,
          {
            type: "GUILD_VOICE",
            parent: category.id,
          },
        );

        await interaction.reply({
          content: `Form approved and role '${teamName}' assigned to the user ${username}. Team channels created.`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `User '${username}' not found in the guild.`,
          ephemeral: true,
        });
      }
    } else if (action === "reject") {
      await updateSubmissionStatus(submissionId, "rejected");
      await moveAndEditMessage(
        originalMessage,
        REJECTED_CHANNEL_ID,
        "Rejected",
      );
      await interaction.reply({
        content: "Form rejected and moved to the rejected channel.",
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("Error in interaction:", error);
    await interaction.reply({
      content:
        "There was an error processing the form. Please try again later.",
      ephemeral: true,
    });
  }
});

async function moveAndEditMessage(originalMessage, targetChannelId, newStatus) {
  const color = newStatus === "Approved" ? "#57F287" : "#ED4245";
  const statusEmoji = newStatus === "Approved" ? "✅" : "❌";

  let statusField = originalMessage.embeds[0].fields.find(
    (field) => field.name === "Status",
  );
  const updatedEmbed = new MessageEmbed(originalMessage.embeds[0]).setColor(
    color,
  );

  if (statusField) {
    statusField.value = `${statusEmoji} ${newStatus}`;
  } else {
    updatedEmbed.addField("Status", `${statusEmoji} ${newStatus}`);
  }

  const channel = client.channels.cache.get(targetChannelId);
  if (channel) {
    await channel.send({ embeds: [updatedEmbed], components: [] });
    await originalMessage.delete();
  }
}

async function updateSubmissionStatus(submissionId, status) {
  const response = await fetch(UPDATE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId, status }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }
}

client.login(process.env.CLIENT_BOT_TOKEN);
