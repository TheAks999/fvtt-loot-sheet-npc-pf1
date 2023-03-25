/*************************
 * Global static actions 
 *************************
*/
export class LootSheetActions {

  /**
   * Displays a message into the chat log
   */
  static chatMessage(speaker, owner, message, item) {
    if (game.settings.get("lootsheetnpcpf1", "buyChat")) {
      if (item) {
        message = `<div class="pf1 chat-card item-card" data-actor-id="${owner._id}" data-item-id="${item._id}">
                    <header class="card-header flexrow">
                        <img src="${item.img}" title="${item.showName}" width="36" height="36">
                        <h3 class="item-name">${item.showName}</h3>
                    </header>
                    <div class="card-content"><p>${message}</p></div></div>`;
      } else {
        message = `<div class="pf1 chat-card item-card" data-actor-id="${owner._id}">
                    <div class="card-content"><p>${message}</p></div></div>`;
      }
      ChatMessage.create({
        user: game.user._id,
        speaker: {
          actor: speaker,
          alias: speaker.name
        },
        content: message
      });
    }
  }

  /**
   * Sends a error message to the target user
   */
  static errorMessageToActor(target, message) {
    game.socket.emit("module.lootsheetnpcpf1", {
      type: "error",
      targetId: target.id,
      message: message
    });
  }

  /**
   * Moves an item from a source actor to a destination actor
   */
  static moveItem(source, destination, itemId, quantity) {
    //console.log("Loot Sheet | moveItem")
    let item = source.getEmbeddedDocument("Item", itemId);
    
    if(!item) {
      ui.notifications.warn(game.i18n.format("ERROR.lsInvalidMove", { actor: source.name }));
      console.log(source, destination, itemId)
      return null;
    }
    
    if(!quantity) {
      quantity = item.quantity
    }
    
    // Move all items if we select more than the quantity.
    if (item.quantity < quantity) {
      quantity = item.quantity;
    }

    let newItem = duplicate(item);
    
    // remove unecessary flags
    if(newItem.flags.lootsheetnpcpf1) {
      delete(newItem.flags.lootsheetnpcpf1)
    }

    // decrease the quantity (unless infinite)
    if(!item.flags.lootsheetnpcpf1 || !item.flags.lootsheetnpcpf1.infinite) {
      const update = {
        _id: itemId,
        quantity: item.quantity - quantity
      };

      let removeEmptyStacks = game.settings.get("lootsheetnpcpf1", "removeEmptyStacks");
      if (update.quantity === 0 && removeEmptyStacks) {
        source.deleteEmbeddedDocuments("Item", [itemId]);
      } else {
        source.updateEmbeddedDocuments("Item", [update]);
      }
    }

    newItem.quantity = quantity;
    destination.createEmbeddedDocuments("Item", [newItem]);
    newItem.showName = LootSheetActions.getItemName(newItem)
    newItem.showCost = LootSheetActions.getItemCost(newItem)
    
    return {
      item: newItem,
      quantity: quantity
    };

  }

  static spreadFunds(totalGP, funds) {
    const gpBare = Math.floor(totalGP),
      spLeftOver = (totalGP - gpBare) * 10,
      spBare = Math.floor(spLeftOver),
      cpLeftOver = (spLeftOver - spBare) * 10,
      cpBare = Math.floor(cpLeftOver);
    funds.gp += gpBare;
    funds.sp += spBare;
    funds.cp += cpBare;
    return funds;
  }

  /**
   * Moves coins from a source actor to a destination actor
   */
  static moveCoins(source, destination, itemId, quantity) {
    //console.log("Loot Sheet | moveCoins")
    
    if(itemId.startsWith("wl_")) {
      itemId = itemId.substring(3)
      
      // Move all items if we select more than the quantity.
      let coins = source.system.altCurrency[itemId]
      if (coins < quantity) {
        quantity = coins;
      }
      
      if (quantity === 0) return null;

      const srcUpdate = { system: { altCurrency: { } } };
      srcUpdate.altCurrency[itemId] = source.system.altCurrency[itemId] - quantity;
      source.update(srcUpdate)
      
      const dstUpdate = { system: { altCurrency: { } } };
      dstUpdate.altCurrency[itemId] = destination.system.altCurrency[itemId] + quantity;
      destination.update(dstUpdate)
    }
    else {
      // Move all items if we select more than the quantity.
      let coins = source.system.currency[itemId]
      if (coins < quantity) {
        quantity = coins;
      }
      
      if (quantity === 0) return null;

      const srcUpdate = { system: { currency: { } } };
      srcUpdate.currency[itemId] = source.system.currency[itemId] - quantity;
      source.update(srcUpdate)
      
      const dstUpdate = { system: { currency: { } } };
      dstUpdate.currency[itemId] = destination.system.currency[itemId] + quantity;
      destination.update(dstUpdate)
    }
    
    return {
      quantity: quantity
    };

  }

  /**
   * A looter (target actor) takes an item from a container (source actor)
   */
  static lootItem(speaker, container, looter, itemId, quantity) {
    console.log("Loot Sheet | LootSheetActions.lootItem")
    
    if (itemId.length === 2 || itemId.startsWith("wl_")) {
      let moved = LootSheetActions.moveCoins(container, looter, itemId, quantity);

      if (moved) {
        LootSheetActions.chatMessage(
          speaker, looter,
          game.i18n.format("ls.chatLootCoins", { buyer: looter.name, quantity: moved.quantity, currency: game.i18n.localize("ls." + itemId) }));
      }
    }
    else {
      let moved = LootSheetActions.moveItem(container, looter, itemId, quantity);
      if(!moved) return;

      LootSheetActions.chatMessage(
        speaker, looter,
        game.i18n.format("ls.chatLoot", { buyer: looter.name, quantity: moved.quantity, name: moved.item.showName }),
        moved.item);
    }
  }
  
  /**
   * A giver (source actor) drops or sells a item to a container (target actor)
   */
  static async dropOrSellItem(speaker, container, giver, itemId) {
    //console.log("Loot Sheet | Drop or sell item")
    let moved = LootSheetActions.moveItem(giver, container, itemId);
    if(!moved) return;
    let messageKey;
    let cost = moved.item.showCost;

    if(container.getFlag("lootsheetnpcpf1", "lootsheettype") === "Merchant") {
      messageKey = "ls.chatSell"
      let sellerFunds = duplicate(giver.system.currency)
      if(sellerFunds && moved.item.showCost > 0) {
        if( moved.item.subType !== "tradeGoods" )
          cost = cost / 2;

        const totalGP = cost * moved.quantity;
        sellerFunds = LootSheetActions.spreadFunds(totalGP, sellerFunds);
        await giver.update({ "system.currency": sellerFunds });
      }
    } else {
      messageKey = "ls.chatDrop"
    }
  
    LootSheetActions.chatMessage(
      speaker, giver,
      game.i18n.format(messageKey, { seller: giver.name, quantity: moved.quantity, price: cost * moved.quantity, item: moved.item.showName, container: container.name }), 
      moved.item);
  }
  
  /**
   * Quick function to do a trasaction between a seller (source) and a buyer (target)
   */
  static async transaction(speaker, seller, buyer, itemId, quantity) {
    console.log("Loot Sheet | Transaction")

    let sellItem = seller.getEmbeddedDocument("Item", itemId);


    // If the buyer attempts to buy more then what's in stock, buy all the stock.
    if (sellItem.quantity < quantity) {
      quantity = sellItem.quantity;
    }

    let sellerModifier = seller.getFlag("lootsheetnpcpf1", "priceModifier");
    if (!sellerModifier) sellerModifier = 1.0;

    let itemCost = LootSheetActions.getItemCost(sellItem)
    itemCost = itemCost * sellerModifier;
    itemCost *= quantity;
    let buyerFunds = duplicate(buyer.system.currency);
    let buyerFundsAlt = duplicate(buyer.system.altCurrency);
    const conversionRate = {
      "pp": 10,
      "gp": 1,
      "sp": 0.1,
      "cp": 0.01
    };
    let buyerFundsAsGold = 0;
    let buyerFundsAsGoldAlt = 0;

    for (let currency in buyerFunds) {
      buyerFundsAsGold += Math.floor(buyerFunds[currency] * conversionRate[currency]);
    }
    for (let currency in buyerFundsAlt) {
      buyerFundsAsGoldAlt += Math.floor(buyerFundsAlt[currency] * conversionRate[currency]);
    }

    if (itemCost > buyerFundsAsGold + buyerFundsAsGoldAlt) {
      LootSheetActions.errorMessageToActor(buyer, game.i18n.localize("ERROR.lsNotEnougFunds"));
      return;
    }
    const originalCost = itemCost;
    
    // Update buyer's gold
    
    // make sure that coins is a number (not a float)
    while(!Number.isInteger(itemCost)) {

      itemCost *= 10;
      for (const key in conversionRate) {
        conversionRate[key] *= 10
      }
    }
    
    // cost can be paid with funds
    if (itemCost <= buyerFundsAsGold) {
      buyerFunds = LootSheetActions.removeCostFromFunds(buyer, itemCost, buyerFunds, conversionRate);
      await buyer.update({ "system.currency": buyerFunds });
    }
    // cost must also be paid with weightless funds
    else {
      buyerFunds = LootSheetActions.removeCostFromFunds(buyer, buyerFundsAsGold, buyerFunds, conversionRate);
      buyerFundsAlt = LootSheetActions.removeCostFromFunds(buyer, itemCost - buyerFundsAsGold, buyerFundsAlt, conversionRate);
      await buyer.update({ "system.currency": buyerFunds, "data.altCurrency": buyerFundsAlt });
    }
    

    let moved = LootSheetActions.moveItem(seller, buyer, itemId, quantity);

    if(moved) {
      LootSheetActions.chatMessage(
        speaker, buyer,
        game.i18n.format("ls.chatPurchase", { buyer: buyer.name, quantity: quantity, name: moved.item.showName, cost: originalCost }),
        moved.item);
    }
  }
  
  /**
   * Remove cost from actor's funds using provided conversionRate
   */
  static removeCostFromFunds(buyer, cost, funds, conversionRate, DEBUG = false) {
    if (DEBUG) console.log("Loot Sheet | Conversion rates: ");
    if (DEBUG) console.log(conversionRate);
    
    // remove funds from lowest currency to highest
    let remainingFond = 0
    for (const currency of Object.keys(conversionRate).reverse()) {
      //console.log("Rate: " + conversionRate[currency])
      if(conversionRate[currency] < 1) {
        const ratio = 1/conversionRate[currency]
        const value = Math.min(cost, Math.floor(funds[currency] / ratio))
        if (DEBUG) console.log("Loot Sheet | BuyerFunds " + currency + ": " + funds[currency])
        if (DEBUG) console.log("Loot Sheet | Ratio: " + ratio)
        if (DEBUG) console.log("Loot Sheet | Value: " + value)
        cost -= value
        funds[currency] -= value * ratio
      } else {
        const value = Math.min(cost, Math.floor(funds[currency] * conversionRate[currency]))
        cost -= value
        const lost = Math.ceil( value / conversionRate[currency] )
        funds[currency] -= lost
        remainingFond += lost * conversionRate[currency] - value
        if (DEBUG) console.log("Loot Sheet | Value+: " + value)
        if (DEBUG) console.log("Loot Sheet | Lost+: " + lost)
        if (DEBUG) console.log("Loot Sheet | RemainingFond+: " + remainingFond)
      }
    }
    
    if(cost > 0) {
      LootSheetActions.errorMessageToActor(buyer, game.i18n.localize("ERROR.lsCurrencyConversionFailed"));
      ui.notifications.error(game.i18n.localize("ERROR.lsCurrencyConversionFailed"));
      throw "Couldn't remove from funds"
    }
    
    //console.log("RemainingFond: " + remainingFond)
    
    if(remainingFond > 0) {
      for (const currency of Object.keys(conversionRate)) {
        if (conversionRate[currency] <= remainingFond) {
          funds[currency] += Math.floor(remainingFond / conversionRate[currency]);
          remainingFond = remainingFond % conversionRate[currency];
          if (DEBUG) console.log("Loot Sheet | funds " + currency + ": " + funds[currency]);
          if (DEBUG) console.log("Loot Sheet | remainingFond: " + remainingFond);
        }
      }
    }
    
    if(remainingFond > 0) {
      LootSheetActions.errorMessageToActor(buyer, game.i18n.localize("ERROR.lsCurrencyConversionFailed"));
      return ui.notifications.error(game.i18n.localize("ERROR.lsCurrencyConversionFailed"));
      throw "Couldn't remove from funds"
    }
    
    if (DEBUG) console.log(funds)
    return funds;
  }
  
  /**
   * Actor gives something to another actor
   */
  static giveItem(speaker, giverId, receiverId, itemId, quantity) {
    quantity = Number(quantity)  // convert to number (just in case)
    
    let giver = game.actors.get(giverId);
    let receiver = game.actors.get(receiverId);
  
    let giverUser = null;
      game.users.forEach((u) => {
      if (u.character && u.character._id === giverId) {
        giverUser = u;
      }
    });
      
    if(quantity <= 0) {
      return;
    }
    
    if (giver && receiver) {
      let moved = LootSheetActions.moveItem(giver, receiver, itemId, quantity);
      if(moved) {
        LootSheetActions.chatMessage(
          speaker, receiver,
          game.i18n.format("ls.chatGive", {giver: giver.name, receiver: receiver.name, quantity: quantity, item: moved.item.showName}),
          moved.item);
      }
    } else {
      console.log("Loot Sheet | Give operation failed because actors (giver or receiver) couldn't be found!");
    }
  }


  /**
   * Returns the unidentified name (if unidentified and specified) or the name
   */
  static getItemName(item) {
    if(!item) return ""
    else return item.identified || !item.unidentified || !item.unidentified.name || item.unidentified.name.length === 0 ? item.name : item.unidentified.name
  }

  /**
   * Returns the unidentified cost (if unidentified and specified) or the cost
   */
  static getItemCost(item)
  {
    if(!item)
    {
      return 0
    }
    else
    {
      return Number(item.identified || item.unidentified == null ? item.price : item.unidentified.price)
    }
  }
  
  /**
   * Returns the sale value of an item
   */
  static getItemSaleValue(item, saleValue)
  {
    if(!item)
    {
      return 0;
    }
    if(item.type === "container")
    {
      let total = LootSheetActions.getItemCost(item) * saleValue;
      if(item.inventoryItems)
      {
        item.inventoryItems.forEach(i => total += LootSheetActions.getItemSaleValue(i, saleValue));
      }
      return total;
    }
    else if (["weapon", "equipment", "consumable", "tool", "loot"].indexOf(item.type) >= 0)
    {
      if( item.subType !== "tradeGoods" )
      {
        return LootSheetActions.getItemCost(item) * saleValue;
      }
      return LootSheetActions.getItemCost(item);
    }
    return 0;
  }
}
