import {LootSheetActions} from "./actions.js";
import {LootSheetConstants} from "./constants.js";
import {QuantityDialog} from "./quantity-dialog.js";
import {debug_log} from "./logging.js";

export class LootSheetPf1NPC extends game.pf1.applications.ActorSheetPFNPC
{

  static DEFAULT_TOKEN = "icons/svg/mystery-man.svg"

  get template()
  {
    // adding the #equals and #unequals handlebars helper
    Handlebars.registerHelper('equals', function (arg1, arg2, options)
    {
      return (arg1 === arg2) ? options.fn(this) : options.inverse(this);
    });

    Handlebars.registerHelper('unequals', function (arg1, arg2, options)
    {
      return (arg1 !== arg2) ? options.fn(this) : options.inverse(this);
    });

    Handlebars.registerHelper('lootsheetprice', function (basePrice, modifier)
    {
      return Math.round(basePrice * modifier * 100) / 100;
    });

    Handlebars.registerHelper('lootsheetweight', function (baseWeight, count)
    {
      return baseWeight * count;
    });

    Handlebars.registerHelper('lootsheetname', function (name, quantity, infinite)
    {
      if (infinite)
      {
        return `(∞) ${name}`
      }
      return quantity > 1 ? `(${quantity}) ${name}` : name;
    });

    const path = "systems/pf1/templates/actors/";
    return "modules/lootsheetnpcpf1/template/npc-sheet.html";
  }

  static get defaultOptions()
  {
    const options = super.defaultOptions;

    mergeObject(options, {
      classes: ["pf1 sheet actor npc npc-sheet loot-sheet-npc"],
      width: 850,
      height: 750
    });
    return options;
  }

  /**
   * Returns the loot price that the player is aware of
   */
  getLootPrice(item)
  {
    if (game.user.isGM || item.identified)
    {
      return item.price;
    }
    return LootSheetActions.getItemCost(item);
  }

  /**
   * Returns the loot name that the player knows
   */
  getLootName(item)
  {
    if (game.user.isGM || item.identified)
    {
      return item.name;
    }
    return LootSheetActions.getItemName(item);
  }

  async getData()
  {
    debug_log("Loot Sheet | getData")

    const sheetData = await super.getData();

    // https://foundryvtt.wiki/en/migrations/foundry-core-0_8_x
    sheetData.flags = sheetData.actor.flags

    // Prepare GM Settings
    sheetData.flags.loot = this._prepareGMSettings(sheetData);
    debug_log(sheetData)

    // Prepare isGM attribute in sheet Data

    debug_log("game.user: ", game.user);
    sheetData.isGM = !!game.user.isGM;
    debug_log("sheetData.isGM: ", sheetData.isGM);
    debug_log(this.actor);

    let lootsheettype = await this.actor.getFlag(LootSheetConstants.MODULENAME, "lootsheettype");
    if (!lootsheettype)
    {
      lootsheettype = "Loot"
      await this.actor.setFlag(LootSheetConstants.MODULENAME, "lootsheettype", lootsheettype);
    }
    debug_log(`Loot Sheet | Loot sheet type = ${lootsheettype}`);

    let rolltable = await this.actor.getFlag(LootSheetConstants.MODULENAME, "rolltable");
    debug_log(`Loot Sheet | Rolltable = ${rolltable}`);


    let priceModifier = 1.0;
    if (lootsheettype === "Merchant")
    {
      priceModifier = await this.actor.getFlag(LootSheetConstants.MODULENAME, "priceModifier");
      if (!priceModifier)
      {
        await this.actor.setFlag(LootSheetConstants.MODULENAME, "priceModifier", 1.0);
      }
      priceModifier = await this.actor.getFlag(LootSheetConstants.MODULENAME, "priceModifier");
    }

    let totalItems = 0;
    let totalWeight = 0;
    let totalPrice = 0;
    let adjustedPrice = 0;
    let maxCapacity = await this.actor.getFlag(LootSheetConstants.MODULENAME, "maxCapacity") || 0;
    let maxLoad = await this.actor.getFlag(LootSheetConstants.MODULENAME, "maxLoad") || 0;
    let saleValue = await this.actor.getFlag(LootSheetConstants.MODULENAME, "saleValue") || 50;
    let displaySaleValueEnabled = await this.actor.getFlag(LootSheetConstants.MODULENAME, "displaySaleValueEnabled");

    Object.keys(sheetData.actor.features).forEach(f => sheetData.actor.features[f].items.forEach(i =>
    {
      // specify if empty
      const itemQuantity = getProperty(i, "data.quantity") != null ? getProperty(i, "data.quantity") : 1;
      const itemCharges = getProperty(i, "data.uses.value") != null ? getProperty(i, "data.uses.value") : 1;
      i.empty = itemQuantity <= 0 || (i.isCharged && itemCharges <= 0);

      totalItems += itemQuantity;
      totalWeight += itemQuantity * i.weightConverted;
      totalPrice += itemQuantity * LootSheetActions.getItemCost(i);
      adjustedPrice += itemQuantity * LootSheetActions.getItemSaleValue(i, saleValue / 100);
    }));

    sheetData.lootsheettype = lootsheettype;
    sheetData.rolltable = rolltable;
    sheetData.priceModifier = priceModifier;
    sheetData.rolltables = game.tables.contents;
    debug_log(sheetData)
    sheetData.canAct = game.user.playerId in sheetData.actor.ownership && sheetData.actor.ownership[game.user.playerId] === 2;
    sheetData.totalItems = totalItems;
    sheetData.maxItems = maxCapacity > 0 ? " / " + maxCapacity : "";
    sheetData.itemsWarning = maxCapacity <= 0 || maxCapacity >= totalItems ? "" : "warn";
    sheetData.totalWeight = Math.ceil(totalWeight);
    sheetData.maxWeight = maxLoad > 0 ? " / " + maxLoad : "";
    sheetData.weightWarning = maxLoad <= 0 || maxLoad >= totalWeight ? "" : "warn";
    sheetData.totalPrice = totalPrice;
    sheetData.weightUnit = game.settings.get("pf1", "units") === "metric" ? game.i18n.localize("PF1.Kgs") : game.i18n.localize("PF1.Lbs");
    sheetData.saleValue = saleValue < 0 ? 0 : saleValue;
    sheetData.adjustedPrice = adjustedPrice;
    sheetData.displaySaleValueEnabled = displaySaleValueEnabled;

    // workaround to get all flags
    const rolltableName = await this.actor.getFlag(LootSheetConstants.MODULENAME, "rolltable");
    const shopQtyFormula = await this.actor.getFlag(LootSheetConstants.MODULENAME, "shopQty") || "1";
    const itemQtyFormula = await this.actor.getFlag(LootSheetConstants.MODULENAME, "itemQty") || "1";

    // Return data for rendering
    return sheetData;
  }

  /* -------------------------------------------- */

  /*  Event Listeners and Handlers
  /* -------------------------------------------- */

  /**
   * Activate event listeners using the prepared sheet HTML
   * @param html {HTML}   The prepared HTML object ready to be rendered into the DOM
   */
  async activateListeners(html)
  {
    console.log("Loot Sheet | activateListeners")
    super.activateListeners(html);

    const dragEnabled = await this.actor.getFlag(LootSheetConstants.MODULENAME, "dragEnabled");
    if (!dragEnabled)
    {
      // Remove dragging capability
      let handler = ev => this._onDragItemStart(ev);
      html.find('li.item').each((i, li) =>
      {
        if (li.classList.contains("inventory-header"))
        {
          return;
        }
        li.setAttribute("draggable", false);
        li.removeEventListener("dragstart", handler);
      });
    }

    if (this.options.editable)
    {
      // Toggle Permissions
      html.find('.permission-proficiency').click(ev => this._onCyclePermissionProficiency(ev));

      // Toggle Permissions (batch)
      html.find('.permission-batch').click(ev => this._onBatchPermissionChange(ev));

      // Split Coins
      html.find('.split-coins').click(ev => this._distributeCoins(ev));

      // Price Modifier
      html.find('.price-modifier').click(ev => this._priceModifier(ev));

      // Price Modifier
      html.find('.convert-loot').click(ev => this._convertLoot(ev));

      //html.find('.merchant-settings').change(ev => this._merchantSettingChange(ev));
      html.find('.update-inventory').click(ev => this._merchantInventoryUpdate(ev));
    }

    // Buy Item
    html.find('.item-buy').click(ev => this._buyItem(ev));

    // Loot Item
    html.find('.item-loot').click(ev => this._lootItem(ev));

    // Toggle Visibility
    html.find('.item-visibility').click(ev => this._toggleVisibility(ev));

    // Infinite quantity
    html.find('.item-quantity-infinite').click(ev => this._toggleInfiniteQuantity(ev));

  }

  /* -------------------------------------------- */

  /**
   * Handle merchant settings change
   * @private
   */
  async _merchantSettingChange(event, html)
  {
    event.preventDefault();
    console.log("Loot Sheet | Merchant settings changed", event);

    if (!game.user.isGM)
    {
      return;
    }

    const expectedKeys = ["rolltable", "shopQty", "itemQty"];
    let targetKey = event.target.name.split('.')[3];

    if (expectedKeys.indexOf(targetKey) === -1)
    {
      console.log(`Loot Sheet | Error changing stettings for "${targetKey}".`);
      return ui.notifications.error(game.i18n.format("ERROR.lsChangingSettingsFor", {name: targetKey}));
    }

    if (event.target.value)
    {
      await this.actor.setFlag(LootSheetConstants.MODULENAME, targetKey, event.target.value);
    }
    else
    {
      await this.actor.unsetFlag(LootSheetConstants.MODULENAME, targetKey, event.target.value);
    }
  }

  /* -------------------------------------------- */
  /*  Form Submission                             */

  /* -------------------------------------------- */

  async _updateObject(event, formData)
  {
    let flags = Object.entries(formData).filter(e => e[0].startsWith("data.flags."));
    for (let i = 0; i < flags.length; i++)
    {
      const name = flags[i][0].split(".")
      const value = flags[i][1]
      // Ex : data.flags.lootsheetnpcpf1.dragEnabled
      // check if has changed
      if (name.length === 4)
      {
        if (this.actor.getFlag(name[2], name[3]) !== value)
        {
          console.log(`Setting flag ${name[2]}.${name[3]} to ${value}`)
          await this.actor.setFlag(name[2], name[3], value)
        }
        //handle displaySaleValueEnabled
        let flagValue = this.actor.getFlag(name[2], "displaySaleValueEnabled");
        let formValue = Object.entries(formData).filter(f => f[0].startsWith("data.flags.lootsheetnpcpf1.displaySaleValueEnabled"));
        if (formValue[0])
        {
          if (flagValue !== formValue[0][1])
          {
            await this.actor.setFlag(name[2], "displaySaleValueEnabled", formValue[0][1]);
          }
        }
      }
    }

    return super._updateObject(event, formData);
  }

  /**
   * Required because PF1 _onSubmit tries to updateItems too, which blocks close operation and do other side effects
   */
  async _onSubmit(event, {updateData = null, preventClose = false, preventRender = false} = {})
  {
    event.preventDefault();
    this._submitQueued = false;
    await super._onSubmit(event, {updateData, preventClose, preventRender});
  }


  /* -------------------------------------------- */

  /**
   * Handle merchant inventory update
   * @private
   */
  async _merchantInventoryUpdate(event, html)
  {
    event.preventDefault();
    debug_log("Loot Sheet | _merchantInventoryUpdate")

    if (!game.user.isGM)
    {
      return;
    }

    const rolltableName = await this.actor.getFlag(LootSheetConstants.MODULENAME, "rolltable");
    const shopQtyFormula = await this.actor.getFlag(LootSheetConstants.MODULENAME, "shopQty") || "1";
    const itemQtyFormula = await this.actor.getFlag(LootSheetConstants.MODULENAME, "itemQty") || "1";

    if (!rolltableName || rolltableName.length === 0)
    {
      return ui.notifications.error(game.i18n.format("ERROR.lsChooseTable"));
    }

    let rolltable = game.tables.getName(rolltableName);
    if (!rolltable)
    {
      console.log(`Loot Sheet | No Rollable Table found with name "${rolltableName}".`);
      return ui.notifications.error(game.i18n.format("ERROR.lsNoRollableTableFound", {name: rolltableName}));
    }

    let clearInventory = game.settings.get(LootSheetConstants.MODULENAME, "clearInventory");

    if (clearInventory)
    {

      let currentItems = this.actor.items.map(i => i._id);
      await this.actor.deleteEmbeddedDocuments("Item", currentItems);
    }
    //return;
    let shopQtyRoll = new Roll(shopQtyFormula);

    await shopQtyRoll.roll({async: false});
    console.log(`Loot Sheet | Adding ${shopQtyRoll.result} new items`);

    for (let i = 0; i < shopQtyRoll.result; i++)
    {
      const rollResult = await rolltable.roll({async: false});
      console.log(rollResult)
      let newItem = game.items.get(rollResult.results[0].resultId);
      if (!newItem)
      {
        // search in compendium
        for (const pack of game.packs)
        {
          if (pack.documentClass.documentName === "Item")
          {
            newItem = await pack.getDocument(rollResult.results[0].resultId);
            if (newItem)
            {
              break;
            }
          }
        }

        if (!newItem)
        {
          console.log(`Loot Sheet | No item found "${rollResult.results[0].resultId}".`);
          return ui.notifications.error(`No item found "${rollResult.results[0].resultId}".`);
        }
      }

      let itemQtyRoll = new Roll(itemQtyFormula);
      await itemQtyRoll.roll({async: false});
      console.log(`Loot Sheet | Adding ${itemQtyRoll.result} x ${newItem.name}`)
      const newData = newItem.toJSON()
      newData.quantity = Number(itemQtyRoll.result);
      await this.actor.createEmbeddedDocuments("Item", [newData]);
    }
  }

  // _createRollTable()
  // {
  //   debug_log("Loot Sheet | _createRollTable")
  //
  //   let type = "weapon";
  //
  //   game.packs.map(p => p.collection);
  //
  //   const pack = game.packs.find(p => p.collection === "pf1.items");
  //
  //   let i = 0;
  //
  //   let output = [];
  //
  //   pack.getIndex().then(index => index.forEach(function (arrayItem)
  //   {
  //     debug_log(arrayItem);
  //
  //     i++;
  //     pack.getDocument(arrayItem._id).then(packItem =>
  //     {
  //
  //       if (packItem.type === type)
  //       {
  //
  //         debug_log(packItem);
  //
  //         let newItem = {
  //           "_id": packItem._id,
  //           "flags": {},
  //           "type": 1,
  //           "text": packItem.name,
  //           "img": packItem.img,
  //           "collection": "Item",
  //           "resultId": packItem._id,
  //           "weight": 1,
  //           "range": [
  //             i,
  //             i
  //           ],
  //           "drawn": false
  //         };
  //
  //         output.push(newItem);
  //
  //       }
  //     });
  //   }));
  // }

  /* -------------------------------------------- */

  /**
   * Handle buy item
   * @private
   */
  _buyItem(event)
  {
    event.preventDefault();
    debug_log("Loot Sheet | _buyItem")

    let targetGm = null;
    game.users.forEach((u) =>
    {
      if (u.isGM && u.active && u.viewedScene === game.user.viewedScene)
      {
        targetGm = u;
      }
    });

    if (!targetGm)
    {
      return ui.notifications.error(game.i18n.localize("ERROR.lsNoActiveGM"));
    }

    if (this.token === null)
    {
      return ui.notifications.error(game.i18n.localize("ERROR.lsPurchaseFromToken"));
    }
    if (game.user.actorId)
    {
      let itemId = $(event.currentTarget).parents(".item").attr("data-item-id");
      let quantity = Number($(event.currentTarget).parents(".item").attr("data-item-quantity"));
      let itemName = $(event.currentTarget).parents(".item").find("h4").text()

      let options = {acceptLabel: game.i18n.localize("ls.purchase")}
      if (quantity === 1)
      {
        options['title'] = game.i18n.localize("ls.purchase")
        options['label'] = game.i18n.format("ls.buyContent", {item: itemName})
        options['quantity'] = 1
      }
      else
      {
        options['title'] = game.i18n.format("ls.buyTitle", {item: itemName})
      }

      let d = new QuantityDialog((quantity) =>
      {
        const packet = {
          type: "buy",
          userId: game.user.id,
          actorId: game.user.actorId,
          tokenId: this.token ? this.token.id : undefined,
          targetActorId: this.token ? undefined : this.actor.id,
          itemId: itemId,
          quantity: quantity,
          processorId: targetGm.id
        };
        console.log("LootSheetPf1", "Sending buy request to " + targetGm.name, packet);
        game.socket.emit(LootSheetConstants.SOCKET, packet);
      }, options);
      d.render(true);
    }
    else
    {
      console.log("Loot Sheet | No active character for user");
      return ui.notifications.error(game.i18n.localize("ERROR.lsNoActiveCharacter"));
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle Loot item
   * @private
   */
  _lootItem(event)
  {
    event.preventDefault();
    debug_log("Loot Sheet | _lootItem")

    let targetGm = null;
    game.users.forEach((u) =>
    {
      if (u.isGM && u.active && u.viewedScene === game.user.viewedScene)
      {
        targetGm = u;
      }
    });

    if (!targetGm)
    {
      return ui.notifications.error(game.i18n.localize("ERROR.lsNoActiveGM"));
    }

    if (game.user.actorId)
    {
      let itemId = $(event.currentTarget).parents(".item").attr("data-item-id");
      let quantity = Number($(event.currentTarget).parents(".item").attr("data-item-quantity"));
      let itemName = $(event.currentTarget).parents(".item").find("h4").text()

      let options = {acceptLabel: game.i18n.localize("ls.loot")}
      if (quantity === 1)
      {
        options['title'] = game.i18n.localize("ls.loot")
        options['label'] = game.i18n.format("ls.lootContent", {item: itemName})
        options['quantity'] = 1
      }
      else
      {
        options['title'] = game.i18n.format("ls.lootTitle", {item: itemName})
      }

      let d = new QuantityDialog((quantity) =>
      {
        const packet = {
          type: "loot",
          userId: game.user.id,
          actorId: game.user.actorId,
          tokenId: this.token ? this.token.id : undefined,
          targetActorId: this.token ? undefined : this.actor.id,
          itemId: itemId,
          quantity: quantity,
          processorId: targetGm.id
        };
        console.log("LootSheetPf1", "Sending loot request to " + targetGm.name, packet);
        game.socket.emit(LootSheetConstants.SOCKET, packet);
      }, options);
      d.render(true);
    }
    else
    {
      console.log("Loot Sheet | No active character for user");
      return ui.notifications.error(game.i18n.localize("ERROR.lsNoActiveCharacter"));
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle price modifier.
   * @private
   */
  async _priceModifier(event)
  {
    event.preventDefault();
    debug_log("Loot Sheet | _priceModifier")

    let priceModifier = await this.actor.getFlag(LootSheetConstants.MODULENAME, "priceModifier");
    if (!priceModifier)
    {
      priceModifier = 1.0;
    }

    priceModifier = Math.round(priceModifier * 100);

    renderTemplate("modules/lootsheetnpcpf1/template/dialog-price-modifier.html", {'priceModifier': priceModifier}).then(html =>
    {
      new Dialog({
        title: game.i18n.localize("ls.priceModifierTitle"),
        content: html,
        buttons: {
          one: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("ls.update"),
            callback: () => this.actor.setFlag(LootSheetConstants.MODULENAME, "priceModifier", document.getElementById("price-modifier-percent").value / 100)
          },
          two: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("ls.cancel"),
            callback: () => console.log("Loot Sheet | Price Modifier Cancelled")
          }
        },
        default: "two",
        close: () => console.log("Loot Sheet | Price Modifier Closed")
      }).render(true);
    });

  }

  /* -------------------------------------------- */

  /**
   * Handle buy item
   * @private
   */
  _toggleVisibility(event)
  {
    event.preventDefault();
    let itemId = $(event.currentTarget).parents(".item").attr("data-item-id");
    let item = this.actor.items.get(itemId);
    if (item)
    {
      console.log(item.getFlag(LootSheetConstants.MODULENAME, "secret"))
      if (!item.getFlag(LootSheetConstants.MODULENAME, "secret"))
      {
        item.setFlag(LootSheetConstants.MODULENAME, "secret", true);
      }
      else
      {
        item.setFlag(LootSheetConstants.MODULENAME, "secret", false);
        // unset flag doesn't work???
        //item.unsetFlag(LootSheetConstants.MODULENAME, "secret");
      }
      console.log(item)
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle infinite quantity
   * @private
   */
  _toggleInfiniteQuantity(event)
  {
    event.preventDefault();
    let itemId = $(event.currentTarget).parents(".item").attr("data-item-id");
    let item = this.actor.items.get(itemId);
    if (item)
    {
      if (!item.getFlag(LootSheetConstants.MODULENAME, "infinite"))
      {
        item.setFlag(LootSheetConstants.MODULENAME, "infinite", true);
      }
      else
      {
        item.unsetFlag(LootSheetConstants.MODULENAME, "infinite");
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle conversion to loot. This function converts (and removes) all items
   * on the Loot Sheet into coins. Items are sold according to the normal rule
   * (50% or 100% for trade goods). Price is rounded. Unidentified items are
   * sold according to their unidentified price.
   *
   * @private
   */
  async _convertLoot(event)
  {
    event.preventDefault();
    debug_log("Loot Sheet | _convertLoot")

    Dialog.confirm({
      title: game.i18n.localize("ls.convertLootTitle"),
      content: game.i18n.format("ls.convertLootMessage", {saleValue: this.actor.getFlag(LootSheetConstants.MODULENAME, "saleValue") || 50}),
      yes: async () =>
      {
        let sheetData = await this.getData();
        let totalGP = sheetData.adjustedPrice;
        let funds = LootSheetActions.spreadFunds(totalGP, duplicate(this.actor.currency));
        let deleteList = [];
        this.actor.items.forEach(item =>
        {
          deleteList.push(item.id)
        });

        await this.actor.update({"data.currency": funds});
        await this.actor.deleteEmbeddedDocuments("Item", deleteList)
      },
      no: () =>
      {
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Handle distribution of coins. This function splits all coins
   * into all characters/players that have "act" permissions.
   *
   * @private
   */
  async _distributeCoins(event)
  {
    event.preventDefault();
    debug_log("Loot Sheet | Split Coins clicked");

    let lootSheetActor = this.actor
    let lootActorOwners = [];
    debug_log("Loot Sheet | lootSheetActor", lootSheetActor);
    // Calculate lootActorOwners
    for (let u in this.actor.ownership)
    {
      if (u !== "default" && this.actor.ownership[u] === 2)
      {
        debug_log("Loot Sheet | u in lootSheetActor.permission", u);
        let player = game.users.get(u);
        if (player)
        {
          debug_log("Loot Sheet | player", player);
          let playerActor = game.actors.get(player.character);
          debug_log("Loot Sheet | playerActor", playerActor);
          if (playerActor && (player.role === 1 || player.role === 2))
          {
            lootActorOwners.push(playerActor);
          }
        }
      }
    }

    debug_log("Loot Sheet | lootActorOwners", lootActorOwners);
    if (lootActorOwners.length === 0)
    {
      return;
    }

    // Calculate split of currency
    let currencySplit = duplicate(lootSheetActor.system.currency);
    let altCurrencySplit = duplicate(lootSheetActor.system.altCurrency);
    let currencyRemains = duplicate(lootSheetActor.system.currency);
    let altCurrencyRemains = duplicate(lootSheetActor.system.altCurrency);
    debug_log("Loot Sheet | Currency data", currencySplit);
    for (let c in currencySplit)
    {
      if (lootActorOwners.length)
      {
        currencySplit[c] = Math.floor(currencySplit[c] / lootActorOwners.length);
        altCurrencySplit[c] = Math.floor(altCurrencySplit[c] / lootActorOwners.length);
      }
      else
      {
        currencySplit[c] = 0
        altCurrencySplit[c] = 0
      }

      currencyRemains[c] -= currencySplit[c] * lootActorOwners.length
      altCurrencyRemains[c] -= altCurrencySplit[c] * lootActorOwners.length
    }

    let msg = [];
    for (let u of lootActorOwners)
    {
      debug_log("Loot Sheet | u of lootActorOwners", u);
      if (u === null)
      {
        continue;
      }

      msg = [];
      console.log(u)
      let currency = u.system.currency;
      let altCurrency = u.system.altCurrency;
      let newCurrency = duplicate(u.system.currency);
      let newAltCurrency = duplicate(u.system.altCurrency);

      debug_log("Loot Sheet | Current Currency", currency);
      for (let c in currency)
      {
        if (currencySplit[c])
        {
          msg.push(game.i18n.format("ls.splitcoins", {
            quantity: currencySplit[c],
            currency: game.i18n.localize("ls." + c)
          }));
          newCurrency[c] = currency[c] + currencySplit[c];
        }
        if (altCurrencySplit[c])
        {
          msg.push(game.i18n.format("ls.splitcoins", {
            quantity: altCurrencySplit[c],
            currency: game.i18n.localize("ls.wl_" + c)
          }));
          newAltCurrency[c] = altCurrency[c] + altCurrencySplit[c];
        }
      }

      // Increase currency for players
      u.update({'data.currency': newCurrency, 'data.altCurrency': newAltCurrency});
      // Remove currency from loot actor.
      this.actor.update({"data.currency": currencyRemains, "data.altCurrency": altCurrencyRemains});

      // Create chat message for coins received
      if (msg.length !== 0)
      {
        let message = game.i18n.format("ls.receives", {actor: u.name});
        message += msg.join(",");
        ChatMessage.create({
          user: game.user.id,
          speaker: {
            actor: this.actor,
            alias: this.actor.name
          },
          content: message
        });
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle cycling permissions
   * @private
   */
  _onCyclePermissionProficiency(event)
  {
    event.preventDefault();
    debug_log("Loot Sheet | this.actor.permission", this.actor.permission);

    let field = $(event.currentTarget).siblings('input[type="hidden"]');

    let level = parseFloat(field.val());
    if (typeof level === undefined)
    {
      level = 0;
    }

    debug_log("Loot Sheet | current level " + level);

    const levels = [0, 1, 2]; //const levels = [0, 2, 3];

    let idx = levels.indexOf(level),
      newLevel = levels[(idx === levels.length - 1) ? 0 : idx + 1];

    debug_log("Loot Sheet | new level " + newLevel);

    let playerId = field[0].name;

    debug_log("Loot Sheet | Current actor: " + playerId);
    debug_log(`Current entity permissions are: ${JSON.stringify(this.actor.ownership)}`);

    let permissions = duplicate(this.actor.ownership)
    permissions[playerId] = newLevel;
    debug_log(`About to change permissions are: ${JSON.stringify(permissions)}`);
    this.data.update({permission: permissions});
    debug_log(`Newly changed entity permissions are: ${JSON.stringify(this.actor.ownership)}`);
    this._onSubmit(event);
  }


  _onBatchPermissionChange(event)
  {
    event.preventDefault();
    let newLevel = Number($(event.currentTarget).attr("data-perm"))
    let permissions = duplicate(this.actor.ownership)
    game.users.forEach((u) =>
    {
      if (!u.isGM)
      {
        permissions[u.id] = newLevel
      }
    });
    this.actor.update({permission: permissions});
    this._onSubmit(event);
  }

  /* -------------------------------------------- */

  /**
   * Organize and classify Items for Loot NPC sheets
   * @private
   */
  _prepareItems(actorData)
  {
    console.log("Loot Sheet | _prepareItems")
    // Actions
    const features = {
      weapons: {
        label: game.i18n.localize("ls.weapons"),
        items: [],
        type: "weapon"
      },
      equipment: {
        label: game.i18n.localize("ls.equipment"),
        items: [],
        type: "equipment"
      },
      consumables: {
        label: game.i18n.localize("ls.consumables"),
        items: [],
        type: "consumable"
      },
      loot: {
        label: game.i18n.localize("ls.lootType"),
        items: [],
        type: "loot"
      },
      containers: {
        label: game.i18n.localize("ls.containerType"),
        items: [],
        type: "container"
      },

    };

    //actorData.actor.visible = this.actor.visible

    if (!this.actor.visible)
    {
      actorData.actor.features = features;
      return;
    }

    debug_log("Loot Sheet | Prepare Items");

    // Iterate through items, allocating to containers
    for (let i of actorData.items)
    {
      i.img = i.img || LootSheetPf1NPC.DEFAULT_TOKEN;
      i.showPrice = this.getLootPrice(i)
      i.showName = this.getLootName(i)

      if (!game.user.isGM && i.flags.lootsheetnpcpf1 && i.flags.lootsheetnpcpf1.secret)
      {
        continue;
      }

      if (i.flags.lootsheetnpcpf1 && i.flags.lootsheetnpcpf1.infinite)
      {
        i.quantity = 1
      }

      // Features
      if (i.type === "weapon")
      {
        features.weapons.items.push(i);
      }
      else if (i.type === "equipment")
      {
        features.equipment.items.push(i);
      }
      else if (i.type === "consumable")
      {
        features.consumables.items.push(i);
      }
      else if (i.type === "tool")
      {
        features.tools.items.push(i);
      }
      else if (i.type === "container")
      {
        features.containers.items.push(i);
      }
      else if (i.type === "loot")
      {
        features.loot.items.push(i);
      }
      else
      {
        continue
      }
    }

    // Assign and return
    actorData.actor.features = features;
  }


  /* -------------------------------------------- */


  /**
   * Get the font-awesome icon used to display the permission level.
   * @private
   */
  _getPermissionIcon(level)
  {
    const icons = {
      0: '<i class="far fa-circle"></i>',
      1: '<i class="fas fa-eye"></i>',
      2: '<i class="fas fa-check"></i>'
    };
    return icons[level];
  }

  /* -------------------------------------------- */

  /**
   * Get the font-awesome icon used to display the permission level.
   * @private
   */
  _getPermissionDescription(level) {
    debug_log("_getPermissionDescription")
    const description = {
      0: game.i18n.localize("ls.permissionNoaccess"),
      1: game.i18n.localize("ls.permissionLimited"),
      2: game.i18n.localize("ls.permissionObserver"),
    };
    return description[level];
  }

  /* -------------------------------------------- */

  /**
   * Prepares GM settings to be rendered by the loot sheet.
   * @private
   */
  _prepareGMSettings(lootSheetData)
  {
    const lootSheetActor = lootSheetData.actor;

    debug_log("_prepareGMSettings", lootSheetData)

    const players = [],
      owners = [];
    let user_list = game.users.contents;

    debug_log("_prepareGMSettings | lootSheetActor.permissions", lootSheetActor.ownership);

    for (let user of user_list)
    {
      debug_log("Checking user " + user.name, user);

      //check if the user is a player
      if (!(user.role === 1 || user.role === 2))
      {
        debug_log("User is role 1 or 2")
        continue;
      }

      const playerActor = game.actors.get(user.character.id);
      if (!playerActor)
      {
        debug_log("No Player Actor for " + user.name)
        continue;
      }

      user.actor = playerActor.name;
      user.actorId = playerActor._id;
      user.playerId = user._id;
      if (typeof lootSheetActor.ownership.default !== "undefined")
      {

        debug_log("default permissions", lootSheetActor.ownership.default);

        user.lootPermission = lootSheetActor.ownership.default;

        if (lootSheetActor.ownership.default === 2 && !owners.includes(playerActor._id))
        {
          owners.push(playerActor._id);
        }
      }
      else
      {
        debug_log("assigning 0 permission to hidden field");
        user.lootPermission = 0;
      }

      if (user._id in lootSheetActor.ownership && !owners.includes(playerActor._id))
      {
        debug_log("Found individual actor permission");

        user.lootPermission = lootSheetActor.ownership[user._id];
        
        debug_log("Assigning " + lootSheetActor.ownership[user._id] + " permission to hidden field");

        if (lootSheetActor.ownership[user._id] === 2)
        {
          owners.push(playerActor._id);
        }
      }

      user.icon = this._getPermissionIcon(user.lootPermission);
      user.lootPermissionDescription = this._getPermissionDescription(user.lootPermission);
      players.push(user);
    }

    // calculate the split of coins between all owners of the sheet.
    debug_log(lootSheetActor)
    let currencySplit = duplicate(lootSheetActor.system.currency);
    let altCurrencySplit = duplicate(lootSheetActor.system.altCurrency);
    for (let c in currencySplit)
    {
      if (owners.length)
      {
        currencySplit[c] = Math.floor(currencySplit[c] / owners.length) + " / " + Math.floor(altCurrencySplit[c] / owners.length)
      }
      else
      {
        currencySplit[c] = "0"
      }
    }

    let loot = {}
    loot.warning = lootSheetActor.ownership.default !== 0
    loot.players = players;
    loot.ownerCount = owners.length;
    loot.currency = currencySplit;
    loot.altCurrency = altCurrencySplit;
    return loot
  }

  async _onDrop(event)
  {
    event.preventDefault();

    // Try to extract the data
    let data;
    let extraData = {};
    try
    {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
      if (data.type !== "Item")
      {
        return;
      }
    }
    catch (err)
    {
      return false;
    }

    // Item is from compendium
    if (!data)
    {
      if (game.user.isGM)
      {
        super._onDrop(event)
      }
      else
      {
        ui.notifications.error(game.i18n.localize("ERROR.lsInvalidDrop"));
      }
    }
    // Item from an actor
    else if (game.user.isGM)
    {
      console.log(event)
      console.log(data)
      console.log(await Item.fromDropData(data))
      let sourceActor = game.actors.get(data.actorId);
      let targetActor = this.token ? canvas.tokens.get(this.token.id).actor : this.actor;
      LootSheetActions.dropOrSellItem(game.user, targetActor, sourceActor, data._id)
    }
    // users don't have the rights for the transaction => ask GM to do it
    else
    {
      let targetGm = null;
      game.users.forEach((u) =>
      {
        if (u.isGM && u.active && u.viewedScene === game.user.viewedScene)
        {
          targetGm = u;
        }
      });

      if (targetGm && data.actorId && data && data._id)
      {
        const packet = {
          type: "drop",
          userId: game.user.id,
          actorId: data.actorId,
          itemId: data._id,
          tokenId: this.token ? this.token.id : undefined,
          targetActorId: this.token ? undefined : this.actor.id,
          processorId: targetGm.id
        };
        game.socket.emit(LootSheetConstants.SOCKET, packet);
      }
    }
  }
}
