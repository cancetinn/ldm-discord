import {
  Client,
  Intents,
  MessageEmbed,
  MessageActionRow,
  MessageButton,
} from "discord.js";
import fetch from "node-fetch";

const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES],
});
const REST_API_URL = "http://lidoma-new.local/wp-json/appforms/v1/form-data";
const UPDATE_API_URL =
  "http://lidoma-new.local/wp-json/appforms/v1/update-form";
const CHANNEL_ID = "1172167876417958018";
let lastFormTime = "";

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
      inline: false,
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
      .setStyle("DANGER"),
  );

  const channel = client.channels.cache.get(CHANNEL_ID);
  if (channel) {
    channel.send({ embeds: [embed], components: [row] });
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, submissionId] = interaction.customId.split("_");

  if (action === "approve") {
    await approveSubmission(submissionId);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Form approved!",
        components: [],
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "Form approved!",
        components: [],
        ephemeral: true,
      });
    }
  } else if (action === "reject") {
    await rejectSubmission(submissionId);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Form rejected!",
        components: [],
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "Form rejected!",
        components: [],
        ephemeral: true,
      });
    }
  }
});

//bu kısıma bakacağım
/*client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, submissionId] = interaction.customId.split('_');
    const statusField = interaction.message.embeds[0].fields.find(field => field.name === 'Status');

    if (action === 'approve') {
        statusField.value = 'Approved';
    } else if (action === 'reject') {
        statusField.value = 'Rejected';
    }

    const updatedEmbed = new MessageEmbed(interaction.message.embeds[0])
        .setFields(interaction.message.embeds[0].fields);

    await interaction.reply({ content: `Application updated as ${statusField.value}.`, ephemeral: true });

    await interaction.message.edit({ embeds: [updatedEmbed] });
});*/

async function approveSubmission(submissionId) {
  try {
    const response = await fetch(UPDATE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ submissionId, status: "approved" }),
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
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ submissionId, status: "rejected" }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    console.log("Form rejected successfully");
  } catch (error) {
    console.error("Error rejecting form:", error);
  }
}

client.login(
  "MTE2OTIxOTc5NDc1MTQ2NzU1MQ.G2jgex.yea7hnUvGzsS9Iqid0ouJcwK__ndOedEvYtHSA",
);
