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
    return null; // Hata durumunda null dön
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

  if (action === "approve") {
    await approveSubmission(submissionId);
    await moveAndDeleteMessage(originalMessage, APPROVED_CHANNEL_ID);
    // Kullanıcıya bildirim gönder
    await interaction.reply({
      content: "Form approved and moved!",
      ephemeral: true
    });
  } else if (action === "reject") {
    await rejectSubmission(submissionId);
    await moveAndDeleteMessage(originalMessage, REJECTED_CHANNEL_ID);
    // Kullanıcıya bildirim gönder
    await interaction.reply({
      content: "Form rejected and moved!",
      ephemeral: true
    });
  }
});


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


async function approveSubmission(submissionId) {
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

    console.log("Form approved successfully");
  } catch (error) {
    console.error("Error approving form:", error);
  }
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

async function moveAndDeleteMessage(originalMessage, targetChannelId) {
  const channel = client.channels.cache.get(targetChannelId);
  if (channel) {
    // Mesajı yeni kanala taşı
    channel.send({ embeds: originalMessage.embeds, components: [] });

    // Orijinal mesajı sil
    originalMessage.delete().catch(console.error);
  }
}


client.login(process.env.CLIENT_BOT_TOKEN
);
