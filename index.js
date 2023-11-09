import {
  Client,
  Intents,
  MessageEmbed,
  MessageActionRow,
  MessageButton
} from "discord.js";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]
});
const REST_API_URL = "http://lidoma-new.local/wp-json/appforms/v1/form-data";
const UPDATE_API_URL =
  "http://lidoma-new.local/wp-json/appforms/v1/update-form";
const CHANNEL_ID = "1172185965624836176";
const APPROVED_CHANNEL_ID = "1172184660441313432";
const REJECTED_CHANNEL_ID = "1172184691722432553";
let lastFormTime = "";

async function fetchFormStatus(submissionId) {
  const url = `${REST_API_URL}/${submissionId}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching form status:", error);
    return null;
  }
}

async function fetchFromWordPressAPI(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return response.json();
  } catch (error) {
    console.error("API request error:", error);
  }
}

async function initializeLastFormTime() {
  try {
    const submissions = await fetchFromWordPressAPI(REST_API_URL);
    if (submissions && submissions.length > 0) {
      lastFormTime = submissions[0].time;
    }
  } catch (error) {
    console.error("Error getting form time from API:", error);
  }
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  initializeLastFormTime().then(() => {
    setInterval(checkForNewSubmission, 10000);
  });
});

async function checkForNewSubmission() {
  try {
    const submissions = await fetchFromWordPressAPI(REST_API_URL);
    submissions.forEach((submission) => {
      if (new Date(submission.time) > new Date(lastFormTime)) {
        lastFormTime = submission.time;
        sendToDiscord(submission);
      }
    });
  } catch (error) {
    console.error("Error checking for new submission:", error);
  }
}

function sendToDiscord(submission) {
  const fields = Object.keys(submission).map((key) => {
    return {
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value: String(submission[key]),
      inline: false
    };
  });

  const embed = new MessageEmbed()
    .setTitle("New Form Submission")
    .setColor("#0099ff")
    .addFields(fields)
    .setTimestamp(new Date())
    .setFooter({ text: "LIDOMA BOT" });

  const row = new MessageActionRow().addComponents(
    new MessageButton()
      .setCustomId("approve_" + submission.id)
      .setLabel("Approve")
      .setStyle("SUCCESS"),
    new MessageButton()
      .setCustomId("reject_" + submission.id)
      .setLabel("Reject")
      .setStyle("DANGER")
  );

  const channel = client.channels.cache.get(CHANNEL_ID);
  if (channel) {
    channel.send({ embeds: [embed], components: [row] });
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, submissionId] = interaction.customId.split("_");
  const originalMessage = interaction.message;

  const usernameField = originalMessage.embeds[0].fields.find(field => field.name === "Username");
  const teamNameField = originalMessage.embeds[0].fields.find(field => field.name === "Team_name");

  if (!usernameField || !teamNameField) {
    await interaction.reply({ content: "Required fields not found in the message.", ephemeral: true });
    return;
  }

  try {
    if (action === "approve") {
      await approveSubmission(submissionId, teamNameField.value, usernameField.value);
      await moveAndEditMessage(originalMessage, APPROVED_CHANNEL_ID, "Approved");
      await interaction.reply({
        content: "Form approved, role created and assigned, and moved to the approved channel.",
        ephemeral: true
      });
    } else if (action === "reject") {
      await rejectSubmission(submissionId);
      await moveAndEditMessage(originalMessage, REJECTED_CHANNEL_ID, "Rejected");
      await interaction.reply({
        content: "Form rejected and moved to the rejected channel.",
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Error in interaction:", error);
    await interaction.reply({
      content: "There was an error processing the form. Please try again later.",
      ephemeral: true
    });
  }
});

async function moveAndEditMessage(originalMessage, targetChannelId, status) {
  const updatedEmbed = new MessageEmbed(originalMessage.embeds[0]).addFields({ name: "Status", value: status });
  const channel = client.channels.cache.get(targetChannelId);
  if (channel) {
    await channel.send({ embeds: [updatedEmbed], components: [] });
    await originalMessage.delete().catch(console.error);
  }
}


//bu kısıma bakacağım
/*client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  await interaction.deferReply({ ephemeral: true });

  const [action, submissionId] = interaction.customId.split('_');
  const statusField = interaction.message.embeds[0].fields.find(field => field.name === 'Status');

  if (action === 'approve') {
    statusField.value = 'Approved';
  } else if (action === 'reject') {
    statusField.value = 'Rejected';
  }

  const updatedEmbed = new MessageEmbed(interaction.message.embeds[0])
    .setFields(interaction.message.embeds[0].fields);

  await interaction.message.edit({ embeds: [updatedEmbed] });
  await interaction.followUp({ content: `Application updated as ${statusField.value}.`, ephemeral: true });
});*/

//cancetin isimli role rolu atamıyor ama oluşturuyor.
async function approveSubmission(submissionId, teamName, usernameWithTag) {
  try {
    const response = await fetch(UPDATE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ submissionId, status: "approved" })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
      const role = await guild.roles.create({
        name: teamName,
        reason: "Team role created"
      });

      const member = await findMemberByUsernameTag(guild, usernameWithTag);
      if (member) {
        await member.roles.add(role);
        console.log(`Role '${teamName}' assigned to member '${usernameWithTag}'`);
      } else {
        console.log(`Member '${usernameWithTag}' not found.`);
      }
    } else {
      console.log("Guild not found.");
    }
  } catch (error) {
    console.error("Error in approveSubmission:", error);
  }
}

async function findMemberByUsernameTag(guild, usernameWithTag) {
  let member = null;
  try {
    const members = await guild.members.fetch({ query: usernameWithTag.split("#")[0], limit: 1000 });
    member = members.find(m => `${m.user.username}#${m.user.discriminator}` === usernameWithTag);
  } catch (error) {
    console.error("Error finding member:", error);
  }
  return member;
}

async function rejectSubmission(submissionId) {
  try {
    const response = await fetch(UPDATE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ submissionId, status: "rejected" })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    console.log("Form rejected successfully");
  } catch (error) {
    console.error("Error rejecting form:", error);
  }
}


client.login(process.env.CLIENT_BOT_TOKEN
);
