// Import document classes.
import { SW25Actor } from "./documents/actor.mjs";
import { SW25Item } from "./documents/item.mjs";
import { SW25ActiveEffect } from "./documents/active-effect.mjs";
// Import sheet classes.
import { SW25ActorSheet } from "./sheets/actor-sheet.mjs";
import { SW25ItemSheet } from "./sheets/item-sheet.mjs";
import { SW25ActiveEffectConfig } from "./sheets/active-effect-config.mjs";
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from "./helpers/templates.mjs";
import { SW25 } from "./helpers/config.mjs";
import { chatButton } from "./helpers/chatbutton.mjs";

// Export variable.
export const rpt = {};

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once("init", function () {
  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.sw25 = {
    SW25Actor,
    SW25Item,
    SW25ActiveEffect,
    rollItemMacro,
  };

  // Add custom constants for configuration.
  CONFIG.SW25 = SW25;

  /**
   * Set an initiative formula for the system
   * @type {String}
   */
  CONFIG.Combat.initiative = {
    formula: "2d6",
    decimals: 2,
  };

  // Define custom Document classes
  CONFIG.Actor.documentClass = SW25Actor;
  CONFIG.Item.documentClass = SW25Item;
  CONFIG.ActiveEffect.documentClass = SW25ActiveEffect;

  // Active Effects are never copied to the Actor,
  // but will still apply to the Actor from within the Item
  // if the transfer property on the Active Effect is true.
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Register sheet application classes
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("sw25", SW25ActorSheet, {
    makeDefault: true,
    label: "SW25.SheetLabels.Actor",
  });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("sw25", SW25ItemSheet, {
    makeDefault: true,
    label: "SW25.SheetLabels.Item",
  });

  // Register Active effect sheet Class
  DocumentSheetConfig.unregisterSheet(ActiveEffect, "core", ActiveEffectConfig);
  DocumentSheetConfig.registerSheet(
    ActiveEffect,
    "sw25",
    SW25ActiveEffectConfig,
    {
      makeDefault: true,
      label: "SW25.SheetLabels.ActiveEffect",
    }
  );

  // Preload Handlebars templates.
  return preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

// If you need to add Handlebars helpers, here is a useful example:
Handlebars.registerHelper("toLowerCase", function (str) {
  return str.toLowerCase();
});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once("ready", async function () {
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on("hotbarDrop", (bar, data, slot) => createItemMacro(data, slot));

  // Chat message button
  Hooks.on("renderChatMessage", (chatMessage, html, data) => {
    html.find(".buttonclick").click(function () {
      const button = $(this);
      const buttonType = button.data("buttontype");
      chatButton(chatMessage, buttonType);
    });
  });
  // Add listener to past message
  $(".chat-message .buttonclick").each((index, element) => {
    const messageId = $(element).closest(".message").attr("data-message-id");
    $(element).on("click", (event) => {
      const chatMessage = game.messages.get(messageId);
      const button = $(event.currentTarget);
      const buttonType = button.data("buttontype");
      chatButton(chatMessage, buttonType);
    });
  });

  // Prepare reference data from journal or compendium
  const entryName = "Reference Data";

  async function findEntryInCompendium(entryName) {
    const packs = game.packs
      .filter((p) => p.documentClass.documentName === "JournalEntry")
      .sort((a, b) => a.metadata.label.localeCompare(b.metadata.label));
    for (const pack of packs) {
      const index = await pack.getIndex();
      const entryIndex = index.find((e) => e.name === entryName);
      if (entryIndex) {
        const compEntry = await pack.getDocument(entryIndex._id);
        return compEntry;
      }
    }
    return null;
  }

  let entry = game.journal.getName(entryName);
  if (!entry) {
    entry = await findEntryInCompendium(entryName);
  }
  if (!entry) return;

  // Find power table journal
  const ptPageTitle = "Reference Power Table";
  let ptPage = entry.pages.contents.find((p) => p.name === ptPageTitle);
  if (!ptPage) {
    entry = await findEntryInCompendium(entryName);
    if (entry) {
      ptPage = entry.pages.contents.find((p) => p.name === ptPageTitle);
    }
  }
  if (!ptPage) return;

  // Prepare reference power table
  const ptParser = new DOMParser();
  const ptHtmlString = ptPage.text.content;
  const ptDoc = ptParser.parseFromString(ptHtmlString, "text/html");

  const ptDivs = ptDoc.querySelectorAll("div.pt-item");
  let power = "";

  ptDivs.forEach((div, index) => {
    const ptText = div.querySelector("p").textContent;
    const ptValue = Number(ptText);

    if (index % 11 === 0) {
      power = ptText;
      rpt[power] = [];
    } else {
      rpt[power].push(ptValue);
    }
  });

  // Token change hook
  game.socket.on("system.sw25", (data) => {
    if (!game.user.isGM) return;
    const targetToken = canvas.tokens.get(data.targetToken);
    const target = targetToken.actor;
    if (!target) return;
    target.update({
      "system.hp.value": data.resultHP,
      "system.mp.value": data.resultMP,
    });
  });
});

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createItemMacro(data, slot) {
  // First, determine if this is a valid owned item.
  if (data.type !== "Item") return;
  if (!data.uuid.includes("Actor.") && !data.uuid.includes("Token.")) {
    return ui.notifications.warn(
      "You can only create macro buttons for owned Items"
    );
  }
  // If it is, retrieve it based on the uuid.
  const item = await Item.fromDropData(data);

  // Create the macro command using the uuid.
  const command = `game.sw25.rollItemMacro("${data.uuid}");`;
  let macro = game.macros.find(
    (m) => m.name === item.name && m.command === command
  );
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command: command,
      flags: { "sw25.itemMacro": true },
    });
  }
  game.user.assignHotbarMacro(macro, slot);
  return false;
}

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {string} itemUuid
 */
function rollItemMacro(itemUuid) {
  // Reconstruct the drop data so that we can load the item.
  const dropData = {
    type: "Item",
    uuid: itemUuid,
  };
  // Load the item from the uuid.
  Item.fromDropData(dropData).then((item) => {
    // Determine if the item loaded and if it's an owned item.
    if (!item || !item.parent) {
      const itemName = item?.name ?? itemUuid;
      return ui.notifications.warn(
        `Could not find item ${itemName}. You may need to delete and recreate this macro.`
      );
    }

    // Trigger the item roll
    item.roll();
  });
}
