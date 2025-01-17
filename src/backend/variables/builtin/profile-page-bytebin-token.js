// Migration: done

"use strict";

const cloudSync = require("../../cloud-sync/profile-sync");
const { OutputDataType } = require("../../../shared/variable-constants");

const model = {
    definition: {
        handle: "profilePageBytebinToken",
        description: "Get bytebin id to access allowed commands for a user. Access the json by going to https://bytebin.lucko.me/ID-HERE.",
        possibleDataOutput: [OutputDataType.TEXT]
    },
    evaluator: async (trigger, page = "commands") => {
        const event = trigger.metadata.chatEvent;
        const profileJSON = {
            'username': event.chatEvent.user_name,
            'userRoles': event.chatEvent.user_roles,
            'profilePage': page
        };
        return await cloudSync.syncProfileData(profileJSON);
    }
};

module.exports = model;
