"use strict";


const util = require("../../../utility");
const chat = require("../../../chat/chat");
const commandManager = require("../../../chat/commands/CommandManager");
const gameManager = require("../../game-manager");
const currencyDatabase = require("../../../database/currencyDatabase");
const customRolesManager = require("../../../roles/custom-roles-manager");
const mixerRolesManager = require("../../../../shared/mixer-roles");
const moment = require("moment");

const heistRunner = require("./heist-runner");

const HEIST_COMMAND_ID = "firebot:heist";

const heistCommand = {
    definition: {
        id: HEIST_COMMAND_ID,
        name: "Heist",
        active: true,
        trigger: "!heist",
        description: "Allows viewers to play the Heist game.",
        autoDeleteTrigger: false,
        scanWholeMessage: false,
        hideCooldowns: true,
        baseCommandDescription: "Starts/joins the heist with the default wager amount, if one is set.",
        subCommands: [
            {
                id: "wagerAmount",
                arg: "\\d+",
                regex: true,
                usage: "[wagerAmount]",
                description: "Starts/joins the heist with the given amount.",
                hideCooldowns: true
            }
        ]
    },
    onTriggerEvent: async event => {

        const { chatEvent, userCommand } = event;

        const username = userCommand.commandSender;

        const heistSettings = gameManager.getGameSettings("firebot-heist");
        const chatter = heistSettings.settings.chatSettings.chatter;

        const currencyId = heistSettings.settings.currencySettings.currencyId;
        const currency = currencyDatabase.getCurrencyById(currencyId);

        // make sure the currency still exists
        if (currency == null) {
            chat.sendChatMessage("Unable to start a Heist game as the selected currency appears to not exist anymore.", null, chatter);
            chat.deleteMessage(chatEvent.id);
        }

        // see if the heist is on cooldown before doing anything else
        if (heistRunner.cooldownExpireTime && moment().isBefore(heistRunner.cooldownExpireTime)) {
            const timeRemainingDisplay = util.secondsForHumans(Math.abs(moment().diff(heistRunner.cooldownExpireTime, 'seconds')));
            const cooldownMsg = heistSettings.settings.generalMessages.onCooldown
                .replace("{cooldown}", timeRemainingDisplay);
            chat.sendChatMessage(cooldownMsg, null, chatter);
            return;
        }

        // check if the user has already joined an active heist
        if (heistRunner.lobbyOpen && heistRunner.userOnTeam(username)) {
            const alreadyJoinedMsg = heistSettings.settings.entryMessages.alreadyJoined;
            chat.sendChatMessage(alreadyJoinedMsg, username, chatter);
            chat.deleteMessage(chatEvent.id);
            return;
        }

        // parse the wager amount
        let wagerAmount;
        if (event.userCommand.args.length < 1) {
            let defaultWager = heistSettings.settings.currencySettings.defaultWager;
            if (defaultWager == null || defaultWager < 1) {
                chat.sendChatMessage("Please include a wager amount!", username, chatter);
                chat.deleteMessage(chatEvent.id);
                return;
            }
            wagerAmount = defaultWager;
        }
        if (event.userCommand.subcommandId === "wagerAmount") {
            const triggeredArg = userCommand.args[0];
            wagerAmount = parseInt(triggeredArg);
        } else {
            chat.sendChatMessage("Please include a valid wager amount!", username, chatter);
            chat.deleteMessage(chatEvent.id);
            return;
        }

        wagerAmount = Math.floor(wagerAmount || 0);

        // make sure wager doesnt violate min or max values
        const minWager = heistSettings.settings.currencySettings.minWager || 1;
        if (minWager != null & minWager > 0) {
            if (wagerAmount < minWager) {
                chat.sendChatMessage(`Wager amount must be at least ${minWager}.`, username, chatter);
                chat.deleteMessage(chatEvent.id);
                return;
            }
        }
        const maxWager = heistSettings.settings.currencySettings.maxWager;
        if (maxWager != null & maxWager > 0) {
            if (wagerAmount > maxWager) {
                chat.sendChatMessage(`Wager amount can be no more than ${maxWager}.`, username, chatter);
                chat.deleteMessage(chatEvent.id);
                return;
            }
        }

        // check users balance
        const userBalance = await currencyDatabase.getUserCurrencyAmount(username, currencyId);
        if (userBalance < wagerAmount) {
            chat.sendChatMessage("You don't have enough to wager this amount!", username, chatter);
            chat.deleteMessage(chatEvent.id);
            return;
        }

        // deduct wager from user balance
        await currencyDatabase.adjustCurrencyForUser(username, currencyId, -Math.abs(wagerAmount));

        // Ensure the game has been started and the lobby ready
        if (!heistRunner.lobbyOpen) {

            const startDelay = heistSettings.settings.generalSettings.startDelay || 1;
            heistRunner.triggerLobbyStart(startDelay);

            const teamCreationMessage = heistSettings.settings.generalMessages.teamCreation
                .replace("{user}", username)
                .replace("{command}", userCommand.trigger)
                .replace("{maxWager}", maxWager)
                .replace("{minMager}", minWager)
                .replace("{requiredUsers}", heistSettings.settings.generalSettings.minimumUsers);

            chat.sendChatMessage(teamCreationMessage, null, chatter);
        }

        // get all user roles
        const mappedMixerRoles = (userCommand.senderRoles || [])
            .filter(mr => mr !== "User")
            .map(mr => mixerRolesManager.mapMixerRole(mr));
        const allRoles = mappedMixerRoles.concat(customRolesManager.getAllCustomRolesForViewer(username));

        // get the users success percentage
        let successChance = 50;
        let successChancesSettings = heistSettings.settings.successChanceSettings.successChances;
        if (successChancesSettings) {
            successChance = successChancesSettings.basePercent;

            for (let role of successChancesSettings.roles) {
                if (allRoles.some(r => r.id === role.roleId)) {
                    successChance = role.percent;
                    break;
                }
            }
        }

        // get the users winnings multiplier
        let winningsMultiplier = 1.5;
        let winningsMultiplierSettings = heistSettings.settings.winningsMultiplierSettings.multipliers;
        if (winningsMultiplierSettings) {
            winningsMultiplier = winningsMultiplierSettings.base;

            for (let role of winningsMultiplierSettings.roles) {
                if (allRoles.some(r => r.id === role.roleId)) {
                    winningsMultiplier = role.value;
                    break;
                }
            }
        }

        // add the user to the game
        heistRunner.addUser({
            username: username,
            wager: wagerAmount,
            successPercentage: successChance,
            winnings: Math.floor(wagerAmount * winningsMultiplier)
        });

        const onJoinMessage = heistSettings.settings.entryMessages.onJoin
            .replace("{user}", username)
            .replace("{wager}", util.commafy(wagerAmount))
            .replace("{currency}", currency.name);
        chat.sendChatMessage(onJoinMessage, username, chatter);
    }
};

function registerHeistCommand() {
    if (!commandManager.hasSystemCommand(HEIST_COMMAND_ID)) {
        commandManager.registerSystemCommand(heistCommand);
    }
}

function unregisterHeistCommand() {
    commandManager.unregisterSystemCommand(HEIST_COMMAND_ID);
}

function clearCooldown() {
    heistRunner.clearCooldowns();
}

exports.clearCooldown = clearCooldown;
exports.registerHeistCommand = registerHeistCommand;
exports.unregisterHeistCommand = unregisterHeistCommand;