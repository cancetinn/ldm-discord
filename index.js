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
  const hiddenFields = ["id", "token"];
  const fields = Object.keys(submission)
    .filter(
      (key) =>
        !hiddenFields.includes(key) && key !== "status" && submission[key],
    )
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
    setInterval(checkAndAssignRoles, 10000);
  });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, submissionId] = interaction.customId.split("_");
  const originalMessage = interaction.message;

  const teamNameField = originalMessage.embeds[0].fields.find(
    (field) => field.name === "Team_name",
  );

  if (!teamNameField) {
    await interaction.reply({
      content: "Team name field not found in the message.",
      ephemeral: true,
    });
    return;
  }

  const teamName = teamNameField.value;
  const discordUsernames = [
    "player1_discord",
    "player2_discord",
    "player3_discord",
    "player4_discord",
  ]
    .map(
      (field) =>
        originalMessage.embeds[0].fields.find(
          (f) => f.name.toLowerCase() === field,
        )?.value,
    )
    .filter((username) => username);

  try {
    if (action === "approve") {
      await updateSubmissionStatus(submissionId, "approved");
      await moveAndEditMessage(
        originalMessage,
        APPROVED_CHANNEL_ID,
        "Approved",
      );

      let role = interaction.guild.roles.cache.find((r) => r.name === teamName);
      if (!role) {
        role = await interaction.guild.roles.create({
          name: teamName,
        });
      }

      for (const username of discordUsernames) {
        const members = interaction.guild.members.cache.filter(
          (m) => m.user.username === username,
        );

        if (members.size > 0) {
          members.forEach(async (member) => {
            await member.roles.add(role);
          });
        } else {
          console.log(`User '${username}' not found in the guild.`);
        }
      }

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

      await interaction.guild.channels.create(`📜‎║‎chat‎║`, {
        type: "GUILD_TEXT",
        parent: category.id,
      });

      await interaction.guild.channels.create(`🔊‎║‎voice‎║`, {
        type: "GUILD_VOICE",
        parent: category.id,
      });

      await interaction.reply({
        content: `Form approved, role '${teamName}' assigned, and team channels created.`,
        ephemeral: true,
      });
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

async function checkAndAssignRoles() {
  const submissions = await fetchFromWordPressAPI(REST_API_URL);
  submissions.forEach(async (submission) => {
    if (submission.status === "approved") {
      const teamName = submission.team_name;
      let role = await findOrCreateRole(teamName);

      const discordUsernames = [
        "player1_discord",
        "player2_discord",
        "player3_discord",
        "player4_discord",
      ]
        .map((field) => submission[field])
        .filter((username) => username);

      for (const username of discordUsernames) {
        const member = await findMemberByUsername(username);
        if (member && !member.roles.cache.has(role.id)) {
          await member.roles.add(role);
        }
      }
    }
  });
}

async function findOrCreateRole(teamName) {
  let role = client.guilds.cache
    .get(process.env.GUILD_ID)
    .roles.cache.find((r) => r.name === teamName);
  if (!role) {
    role = await client.guilds.cache.get(process.env.GUILD_ID).roles.create({
      name: teamName,
    });
  }
  return role;
}

async function findMemberByUsername(username) {
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  const members = await guild.members.fetch();
  return members.find(
    (member) => member.user.username.toLowerCase() === username.toLowerCase(),
  );
}

client.login(process.env.CLIENT_BOT_TOKEN);
