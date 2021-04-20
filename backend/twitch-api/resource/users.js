"use strict";

const accountAccess = require("../../common/account-access");

const twitchApi = require("../client");
const { TwitchAPICallType } = require("twitch/lib");

const NodeCache = require("node-cache");

const userRoleCache = new NodeCache({ stdTTL: 30, checkperiod: 5 });

async function getUserChatInfo(userId) {
    const client = twitchApi.getClient();

    const streamer = accountAccess.getAccounts().streamer;

    const chatUser = await client.callAPI({
        type: TwitchAPICallType.Kraken,
        url: `users/${userId}/chat/channels/${streamer.userId}`
    });

    return chatUser;
}

async function getUserChatInfoByName(username) {
    const client = twitchApi.getClient();
    try {
        const user = await client.helix.users.getUserByName(username);
        return getUserChatInfo(user.id);
    } catch (error) {
        return null;
    }
}

async function getUserSubInfo(userId) {
    const client = twitchApi.getClient();

    const streamer = accountAccess.getAccounts().streamer;

    const subInfo = await client.callAPI({
        type: TwitchAPICallType.Kraken,
        url: `channels/${streamer.userId}/subscriptions/${userId}`
    });

    return subInfo;
}

async function getUserSubInfoByName(username) {
    try {
        const user = await client.helix.users.getUserByName(username);
        return getUserSubInfo(user.id);
    } catch (error) {
        return null;
    }
}

async function getUserSubscriberRole(userId) {
    const subInfo = await getUserSubInfo(userId);

    if (subInfo == null || subInfo.sub_plan == null) {
        return null;
    }

    const role = '';
    switch (subInfo.sub_plan) {
    case "Prime":
        role = "Prime";
        break;
    case "1000":
        role = "Tier 1";
        break;
    case "2000":
        role = "Tier 2";
        break;
    case "3000":
        role = "Tier 3";
        break;
    }

    return role;
}

async function getUsersChatRoles(userIdOrName = "") {

    userIdOrName = userIdOrName.toLowerCase();

    /**@type {string[]} */
    const cachedRoles = userRoleCache.get(userIdOrName);

    if (cachedRoles != null) {
        return cachedRoles;
    }

    const isName = isNaN(userIdOrName);

    const userChatInfo = isName ?
        (await getUserChatInfoByName(userIdOrName)) :
        (await getUserChatInfo(userIdOrName));

    if (userChatInfo == null) {
        return [];
    }

    const roles = [];
    if (userChatInfo.badges) {
        for (let badge of userChatInfo.badges) {
            if (badge.id === "broadcaster") {
                roles.push("broadcaster");
            } else if (badge.id === "subscriber" || badge.id === "founder") {
                roles.push("sub");
            } else if (badge.id === "vip") {
                roles.push("vip");
            } else if (badge.id === "moderator") {
                roles.push("mod");
            }
        }
    }

    userRoleCache.set(userChatInfo._id, roles);
    userRoleCache.set(userChatInfo.login, roles);

    return roles;
}

async function updateUserRole(userId, role, addOrRemove) {
    // eslint-disable-next-line no-warning-comments
    //TODO: Needs to be updated for twitch.
    return true;
}

async function getFollowDateForUser(username) {
    const client = twitchApi.getClient();
    const streamerData = accountAccess.getAccounts().streamer;

    const userId = (await client.kraken.users.getUserByName(username)).id;
    const channelId = (await client.kraken.users.getUserByName(streamerData.username)).id;

    const followerDate = (await client.kraken.users.getFollowedChannel(userId, channelId)).followDate;

    if (followerDate == null || followerDate.length < 1) {
        return null;
    }

    return new Date(followerDate);
}

async function doesUserFollowChannel(username, channelName) {
    if (username == null || channelName == null) return false;

    const client = twitchApi.getClient();

    if (username.toLowerCase() === channelName.toLowerCase()) {
        return true;
    }

    const userId = (await client.kraken.users.getUserByName(username)).id;
    const channelId = (await client.kraken.users.getUserByName(channelName)).id;

    if (userId == null || channelId == null) {
        return false;
    }

    const userFollow = await client.kraken.users.getFollowedChannel(userId, channelId);

    if (userFollow == null) {
        return false;
    }

    if (userFollow.followDate == null || userFollow.followDate.length < 1) {
        return false;
    }

    return true;
}

async function toggleFollowOnChannel(channelIdToFollow, shouldFollow = true) {
    if (channelIdToFollow == null) return;

    const client = twitchApi.getClient();

    const user = await client.helix.users.getUserById(channelIdToFollow);

    if (shouldFollow) {
        await user.follow();
    } else {
        await user.unfollow();
    }
}

exports.getUserChatInfoByName = getUserChatInfoByName;
exports.getUserSubInfo = getUserSubInfo;
exports.getUserSubInfoByName = getUserSubInfoByName;
exports.getUserSubscriberRole = getUserSubscriberRole;
exports.getUsersChatRoles = getUsersChatRoles;
exports.getFollowDateForUser = getFollowDateForUser;
exports.toggleFollowOnChannel = toggleFollowOnChannel;
exports.updateUserRole = updateUserRole;
exports.doesUserFollowChannel = doesUserFollowChannel;
