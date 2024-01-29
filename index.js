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

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  initializeLastFormTime().then(() => {
    setInterval(checkForNewSubmission, 10000);
    setInterval(checkAndAssignRoles, 120000);
  });
});

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

function convertToGMT3(dateString) {
  const date = new Date(dateString);
  const utcDate = new Date(date.getTime() + date.getTimezoneOffset() * 60000);
  return new Date(utcDate.getTime() + (180 * 60000));
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
  const color = submission.status === "approved" ? "#57F287" : "#1F8B4C";
  const statusEmoji = submission.status === "approved" ? "🟩" : "🔴";

  const embed = new MessageEmbed()
      .setTitle("New Form Submission")
      .setColor(color)
      .setTimestamp(convertToGMT3(submission.time))
      .setFooter({ text: "LIDOMA BOT" });

  for (let i = 1; i <= 4; i++) {
    const playerDetails =
        `Full Name: ${submission[`player${i}_fullname`] || "N/A"}\n` +
        `IGN: ${submission[`player${i}_ign`] || "N/A"}\n` +
        `UID: ${submission[`player${i}_uid`] || "N/A"}\n` +
        `Email: ${submission[`player${i}_email`] || "N/A"}\n` +
        `Discord: ${submission[`player${i}_discord`] || "N/A"}`;
    embed.addField(`Player ${i}`, playerDetails, false);
  }

  addReserveAndCoachFields(embed, submission);

  Object.keys(submission)
      .filter(
          (key) =>
              !hiddenFields.includes(key) &&
              !key.startsWith("player") &&
              !key.startsWith("reserve_player") && // Yedek oyuncuları hariç tut
              !key.startsWith("coach") && // Koçu hariç tut
              key !== "status" &&
              submission[key],
      )
      .forEach((key) => {
        if (key !== "time") {
          embed.addField(
              key.replace(/_/g, " ").charAt(0).toUpperCase() + key.slice(1),
              String(submission[key]),
              false,
          );
        }
      });

  /*embed.addField(
    "Status",
    `${statusEmoji} ${submission.status.toUpperCase()}`,
    false,
  );*/

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

function addReserveAndCoachFields(embed, submission) {
  // Yedek oyuncular için
  if (submission.reserve_player1_fullname) {
    const reservePlayerDetails =
        `Full Name: ${submission.reserve_player1_fullname}\n` +
        `IGN: ${submission.reserve_player1_ign}\n` +
        `UID: ${submission.reserve_player1_uid}\n` +
        `Email: ${submission.reserve_player1_email}\n` +
        `Discord: ${submission.reserve_player1_discord}`;
    embed.addField("Reserve Player 1", reservePlayerDetails, false);
  }

  if (submission.reserve_player2_fullname) {
    const reservePlayer2Details =
        `Full Name: ${submission.reserve_player2_fullname}\n` +
        `IGN: ${submission.reserve_player2_ign}\n` +
        `UID: ${submission.reserve_player2_uid}\n` +
        `Email: ${submission.reserve_player2_email}\n` +
        `Discord: ${submission.reserve_player2_discord}`;
    embed.addField("Reserve Player 2", reservePlayer2Details, false);
  }

  // Koç için
  if (submission.coach_fullname) {
    const coachDetails =
        `Full Name: ${submission.coach_fullname}\n` +
        `Email: ${submission.coach_email}\n` +
        `Discord: ${submission.coach_discord}`;
    embed.addField("Coach", coachDetails, false);
  }
}

async function assignRolesToMembers(guild, teamName, discordUsernames) {
  let role = guild.roles.cache.find((r) => r.name === teamName);
  if (!role) {
    role = await guild.roles.create({ name: teamName });
  }

  for (const username of discordUsernames) {
    const member = await findMemberByUsername(username);
    if (member && !member.roles.cache.has(role.id)) {
      await member.roles.add(role);
    }
  }
}

function extractUsernamesFromEmbed(embed) {
  const usernames = [];
  embed.fields.forEach((field) => {
    if (field.value.includes("Discord:")) {
      const discordLine = field.value
          .split("\n")
          .find((line) => line.includes("Discord:"));
      if (discordLine) {
        const username = discordLine.split(":")[1].trim();
        if (username && username !== "N/A") {
          usernames.push(username);
        }
      }
    }
  });
  return usernames;
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  await interaction.deferReply();

  const [action, submissionId] = interaction.customId.split("_");
  const originalMessage = interaction.message;

  const teamNameField = originalMessage.embeds[0].fields.find(
      (field) => field.name === "Team_name",
  );
  const discordUsernames = extractUsernamesFromEmbed(originalMessage.embeds[0]);

  if (!teamNameField) {
    await interaction.reply({
      content: "Team name field not found in the message.",
      ephemeral: true,
    });
    return;
  }

  const teamName = teamNameField.value;
  for (let i = 1; i <= 4; i++) {
    const playerNameField = originalMessage.embeds[0].fields.find(
        (field) => field.name === `Player ${i}`,
    );
    if (playerNameField && playerNameField.value.includes("Discord:")) {
      const discordUsername = playerNameField.value
          .split("\n")
          .find((line) => line.startsWith("Discord:"))
          .split(":")[1]
          .trim();
      if (discordUsername && discordUsername !== "N/A") {
        discordUsernames.push(discordUsername);
      }
    }
  }

  await assignRolesToMembers(interaction.guild, teamName, discordUsernames);

  try {
    if (action === "approve") {
      await updateSubmissionStatus(submissionId, "approved");
      updateMessageStatus(originalMessage, "approved");
      await moveAndEditMessage(
          originalMessage,
          APPROVED_CHANNEL_ID,
          "Approved",
      );

      let role = interaction.guild.roles.cache.find((r) => r.name === teamName);
      if (!role) {
        role = interaction.guild.roles.create({ name: teamName });
      }

      for (const username of discordUsernames) {
        const member = await findMemberByUsername(username);
        if (member && !member.roles.cache.has(role.id)) {
          await member.roles.add(role);
        }
      }

      let category = interaction.guild.channels.cache.find(
          (c) => c.name === teamName && c.type === "GUILD_CATEGORY",
      );
      if (!category) {
        category = interaction.guild.channels.create(teamName, {
          type: "GUILD_CATEGORY",
          permissionOverwrites: [
            { id: role.id, allow: ["VIEW_CHANNEL"] },
            { id: interaction.guild.roles.everyone, deny: ["VIEW_CHANNEL"] },
          ],
        });
      }

      [role, category] = await Promise.all([role, category]);

      const textChannel = interaction.guild.channels.create(`📜‎║‎chat‎║`, {
        type: "GUILD_TEXT",
        parent: category.id,
      });

      const voiceChannel = interaction.guild.channels.create(`🔊‎║‎voice‎║`, {
        type: "GUILD_VOICE",
        parent: category.id,
      });

      await Promise.all([textChannel, voiceChannel]);

      await interaction.editReply({
        content: `Form approved, role '${teamName}' assigned, and team channels created.`,
        ephemeral: true,
      });
      setTimeout(() => {
        interaction.deleteReply().catch(console.error);
      }, 10000);
    } else if (action === "reject") {
      await updateSubmissionStatus(submissionId, "rejected");
      updateMessageStatus(originalMessage, "rejected");
      await moveAndEditMessage(
          originalMessage,
          REJECTED_CHANNEL_ID,
          "Rejected",
          updateMessageStatus(originalMessage, "rejected"),
      );
      await interaction.editReply({
        content: "Form rejected and moved to the rejected channel.",
        ephemeral: true,
      });
      setTimeout(() => {
        interaction.deleteReply().catch(console.error);
      }, 10000);
    }
  } catch (error) {
    console.error("Error in interaction:", error);
    await interaction.editReply({
      content: `Form approved, role '${teamName}' assigned, and team channels created.`,
      ephemeral: true,
    });
  }
});

function updateMessageStatus(originalMessage, status) {
  const color = status === "approved" ? "#57F287" : "#ED4245";
  const emoji = status === "approved" ? "🟩" : "🔴";

  const updatedEmbed = new MessageEmbed(originalMessage.embeds[0])
      .setColor(color)
      .spliceFields(0, 1, {
        name: "Status",
        value: `${emoji} ${status.toUpperCase()}`,
        inline: false,
      });

  originalMessage.edit({ embeds: [updatedEmbed] });
}

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
  return members.find((member) => member.user.username === username);
}

client.login(process.env.CLIENT_BOT_TOKEN);
