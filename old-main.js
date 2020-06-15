"use strict";

/**
 * @module Main
 */

const path = require("path");
const url = require("url");
const logger = require("./backend/logwrapper");
logger.info("Starting Firebot...");

const electron = require("electron");
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = electron;
const fs = require("fs-extra");
const windowStateKeeper = require('electron-window-state');
const GhReleases = require("electron-gh-releases");
const settings = require("./backend/common/settings-access").settings;
const dataAccess = require("./backend/common/data-access.js");
const profileManager = require("./backend/common/profile-manager.js");
const backupManager = require("./backend/backupManager");
const webServer = require("./server/httpServer");
const fontManager = require("./backend/fontManager");

const builtInEffectLoader = require("./backend/effects/builtInEffectLoader");
const systemCommandLoader = require("./backend/chat/commands/systemCommandLoader");
const builtInEventSourceLoader = require("./backend/events/builtinEventSourceLoader");
const integrationLoader = require("./backend/integrations/integrationLoader");
const builtInVariableLoader = require("./backend/variables/builtin-variable-loader");
const builtInEventFilterLoader = require("./backend/events/filters/builtin-filter-loader");
const builtInRestrictionsLoader = require("./backend/restrictions/builtin-restrictions-loader");

const Effect = require("./backend/common/EffectType");

require("./backend/interactive/mixplay");

// uncaught exception - log the error
process.on("uncaughtException", logger.error); //eslint-disable-line no-console

function isDev() {
    console.log(process.argv);
    return process.argv && process.argv.length >= 3 && process.argv[2] === '--dev';
}

/**
 * Keeps a global reference of the window object, if you don't, the window will
 * be closed automatically when the JavaScript object is garbage collected.
 */
let mainWindow;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

/** Handle Squirrel events for windows machines */
function squirrelEvents() {
    if (process.platform === "win32") {
        let cp;
        let updateDotExe;
        let target;
        let child;
        switch (process.argv[1]) {
        case "--squirrel-updated":
        // cleanup from last instance

            // use case-fallthrough to do normal installation
            break;
        case "--squirrel-install": //eslint-disable-line no-fallthrough
            // Optional - do things such as:
            // - Install desktop and start menu shortcuts
            // - Add your .exe to the PATH
            // - Write to the registry for things like file associations and explorer context menus

            // Install shortcuts
            cp = require("child_process");
            updateDotExe = path.resolve(
                path.dirname(process.execPath),
                "..",
                "update.exe"
            );
            target = path.basename(process.execPath);
            child = cp.spawn(updateDotExe, ["--createShortcut", target], {
                detached: true
            });
            child.on("close", app.quit);
            return;

        case "--squirrel-uninstall": {
            // Undo anything you did in the --squirrel-install and --squirrel-updated handlers

            //attempt to delete the user-settings folder
            fs.removeSync(dataAccess.getPathInUserData("/user-settings"));

            // Remove shortcuts
            cp = require("child_process");
            updateDotExe = path.resolve(
                path.dirname(process.execPath),
                "..",
                "update.exe"
            );
            target = path.basename(process.execPath);
            child = cp.spawn(updateDotExe, ["--removeShortcut", target], {
                detached: true
            });
            child.on("close", app.quit);
            return true;
        }
        case "--squirrel-obsolete":
            // This is called on the outgoing version of your app before
            // we update to the new version - it's the opposite of
            // --squirrel-updated
            app.quit();
            return;
        }
    }
}
squirrelEvents();

/**
 * Creates the electron window. Sets up a few events such as on closed that are used to control the window.
 * This is also where we start up logging for renderer errors.
 * We also load up our global hotkeys created through the app here.
 * */
function createWindow() {
    logger.info("Creating window...");

    let mainWindowState = windowStateKeeper({
        defaultWidth: 1280,
        defaultHeight: 720
    });

    // Create the browser window.
    mainWindow = new BrowserWindow({
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        minWidth: 300,
        minHeight: 50,
        icon: path.join(__dirname, "./gui/images/logo_transparent_2.png"),
        show: false,
        webPreferences: {
            nodeIntegration: true
        }
    });

    const frontendCommunicator = require("./backend/common/frontend-communicator");
    const menuTemplate = [
        {
            label: 'Edit',
            submenu: [
                {
                    role: 'cut'
                },
                {
                    role: 'copy'
                },
                {
                    role: 'paste'
                }
            ]
        },

        {
            label: 'View',
            submenu: [
                {
                    role: 'resetzoom'
                },
                {
                    role: 'zoomin'
                },
                {
                    role: 'zoomout'
                },
                {
                    type: 'separator'
                },
                {
                    role: 'toggledevtools'
                }
            ]
        },
        {
            label: 'Window',
            submenu: [
                {
                    role: 'minimize'
                },
                {
                    role: 'close'
                }
            ]
        },
        {
            role: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        frontendCommunicator.send("open-about-modal");
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    // register listeners on the window, so we can update the state
    // automatically (the listeners will be removed when the window is closed)
    // and restore the maximized or full screen state
    mainWindowState.manage(mainWindow);

    // and load the index.html of the app.
    mainWindow.loadURL(
        url.format({
            pathname: path.join(__dirname, "./gui/app/index.html"),
            protocol: "file:",
            slashes: true
        })
    );

    // wait for the main window's content to load, then show it
    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow.show();

        const eventManager = require("./backend/events/EventManager");
        eventManager.triggerEvent("firebot", "firebot-started", {
            username: "Firebot"
        });
    });

    mainWindow.webContents.on('new-window', function(e, url) {
        e.preventDefault();
        shell.openExternal(url);
    });

    // Global var for main window.
    global.renderWindow = mainWindow;

    logger.on("logging", (transport, level, msg, meta) => {
        if (renderWindow != null && renderWindow.isDestroyed() === false) {
            renderWindow.webContents.send("logging", {
                transport: transport,
                level: level,
                msg: msg,
                meta: meta
            });
        }
    });

    const hotkeyManager = require("./backend/hotkeys/hotkey-manager");
    hotkeyManager.refreshHotkeyCache();

    const currencyManager = require("./backend/currency/currencyManager");
    currencyManager.startTimer();

    // Connect to DBs.
    logger.info("Creating or connecting user database");
    const userdb = require("./backend/database/userDatabase");
    userdb.connectUserDatabase();

    logger.info("Creating or connecting stats database");
    const statsdb = require("./backend/database/statsDatabase");
    statsdb.connectStatsDatabase();

    logger.info("Creating or connecting quotes database");
    const quotesdb = require("./backend/quotes/quotes-manager");
    quotesdb.loadQuoteDatabase();

    //load patronage data
    const patronageManager = require("./backend/patronageManager");
    patronageManager.loadPatronageData();
}

/**
 * This checks to see if any profiles are marked for deletion. If so, the profile folder is deleted.
 * We mark profiles for deletion so we can delete the files during a restart when they are not in use.
 * Note, most profile management stuff other than this is taken care of in the profile-manager.js file.
 */
async function deleteProfiles() {
    let globalSettingsDb = dataAccess.getJsonDbInUserData("./global-settings");

    let deletedProfile, activeProfiles;
    try {
        deletedProfile = globalSettingsDb.getData("./profiles/deleteProfile");
        activeProfiles = globalSettingsDb.getData("./profiles/activeProfiles");
    } catch (error) {
        if (error.name === 'DatabaseError') {
            logger.error("Error loading deleted and active profiles", error);
        }
    }

    // Stop here if we have no deleted profile info.
    if (deletedProfile == null) return;

    try {

        // Delete the profile.
        logger.warn("Profile " + deletedProfile + " is marked for deletion. Removing it now.");
        logger.warn(dataAccess.getPathInUserData("/profiles") + "\\" + deletedProfile);
        dataAccess.deleteFolderRecursive(
            dataAccess.getPathInUserData("/profiles") + "\\" + deletedProfile
        );

        // Remove it from active profiles.
        let profilePosition = activeProfiles.indexOf(deletedProfile);
        activeProfiles.splice(profilePosition, 1);
        globalSettingsDb.push("/profiles/activeProfiles", activeProfiles);

        // Remove loggedInProfile setting and let restart process handle it.
        if (activeProfiles.length > 0 && activeProfiles != null) {
            // Switch to whatever the first profile is in our new active profiles list.
            globalSettingsDb.push("./profiles/loggedInProfile", activeProfiles[0]);
        } else {
            // We have no more active profiles, delete the loggedInProfile setting.
            globalSettingsDb.delete("./profiles/loggedInProfile");
        }

        // Reset the deleteProfile setting.
        globalSettingsDb.delete("./profiles/deleteProfile");

        // Let our logger know we successfully deleted a profile.
        logger.warn("Successfully deleted profile: " + deletedProfile);

    } catch (err) {
        logger.error("error while deleting profile: ", err);
        return;
    }
}

async function renameProfile() {
    if (!profileManager.hasProfileRename()) return;
    let globalSettingsDb = dataAccess.getJsonDbInUserData("./global-settings");

    try {
        let currentProfileId = profileManager.getLoggedInProfile(),
            newProfileId = profileManager.getNewProfileName(),
            activeProfiles = globalSettingsDb.getData("./profiles/activeProfiles");

        // Stop here if we have no deleted profile info.
        if (currentProfileId != null && newProfileId != null && newProfileId !== "") {
            // Delete the profile.
            logger.warn("Profile " + currentProfileId + " is marked for renaming. Renaming it now.");

            let currentProfilePath = dataAccess.getPathInUserData("/profiles/" + currentProfileId);
            let renamedProfilePath = dataAccess.getPathInUserData("/profiles/" + newProfileId);
            logger.warn(currentProfilePath);

            try {
                fs.renameSync(currentProfilePath, renamedProfilePath);
            } catch (err) {
                logger.error("Failed to rename profile!", err);
                return;
            }

            // Remove old id from active profiles and add new
            let profilePosition = activeProfiles.indexOf(currentProfileId);
            activeProfiles[profilePosition] = newProfileId;
            globalSettingsDb.push("/profiles/activeProfiles", activeProfiles);

            // Update loggedInProfile
            globalSettingsDb.push("./profiles/loggedInProfile", newProfileId);

            // Let our logger know we successfully deleted a profile.
            logger.warn(`Successfully renamed profile "${currentProfileId}" to "${newProfileId}"`);
        }
    } catch (err) {
        logger.error("error while renaming profile!", err);
        return;
    }
}

/**
 * This function creates all of the default folders and files we need to run the app.
 * It will cycle through all profiles and make sure those have default folders as well.
 */
async function createDefaultFoldersAndFiles() {
    logger.info("Ensuring default folders and files exist for all users...");

    //create the root "firebot-data" folder
    dataAccess.createFirebotDataDir();

    // Create the profiles folder if it doesn't exist. It's required
    // for the folders below that are within it
    if (!dataAccess.userDataPathExistsSync("/profiles")) {
        logger.info("Can't find the profiles folder, creating one now...");
        dataAccess.makeDirInUserDataSync("/profiles");
    }

    // Create the backup folder if it doesn't exist
    if (!dataAccess.userDataPathExistsSync("/backups")) {
        logger.info("Can't find the backup folder, creating one now...");
        dataAccess.makeDirInUserDataSync("/backups");
    }

    // Create the clips folder if it doesn't exist
    if (!dataAccess.userDataPathExistsSync("/clips/")) {
        dataAccess.makeDirInUserDataSync("/clips");
    }

    // Okay, now we're going to want to set up individual profile folders or missing folders.
    let globalSettingsDb = dataAccess.getJsonDbInUserData("./global-settings"),
        activeProfiles = [];

    // Check to see if globalSettings file has active profiles listed, otherwise create it.
    // ActiveProfiles is a list of profiles that have not been deleted through the app.
    // This could happen if someone manually deletes a profile.
    try {
        activeProfiles = globalSettingsDb.getData("/profiles/activeProfiles");
    } catch (err) {
        globalSettingsDb.push("/profiles/activeProfiles", ["Main Profile"]);
        activeProfiles = ["Main Profile"];
    }

    // Check to see if we have a "loggedInProfile", if not select one.
    // If we DO have a loggedInProfile, check and make sure that profile is still in our active profile list, if not select the first in the active list.
    // All of this is backup, just in case. It makes sure that we at least have some profile logged in no matter what happens.
    try {
        if (activeProfiles.indexOf(globalSettingsDb.getData("/profiles/loggedInProfile")) === -1) {
            globalSettingsDb.push("/profiles/loggedInProfile", activeProfiles[0]);
            logger.info("Last logged in profile is no longer on the active profile list. Changing it to an active one.");
        } else {
            logger.debug("Last logged in profile is still active!");
        }
    } catch (err) {
        globalSettingsDb.push("/profiles/loggedInProfile", activeProfiles[0]);
        logger.info("Last logged in profile info is missing or this is a new install. Adding it in now.");
    }


    // Loop through active profiles and make sure all folders needed are created.
    // This ensures that even if a folder is manually deleted, it will be recreated instead of erroring out the app somewhere down the line.
    activeProfiles = Object.keys(activeProfiles).map(k => activeProfiles[k]);

    activeProfiles.forEach(profileId => {

        if (profileId != null) {
            if (!dataAccess.userDataPathExistsSync("/profiles/" + profileId)) {
                logger.info("Can't find a profile folder for " + profileId + ", creating one now...");
                dataAccess.makeDirInUserDataSync("/profiles/" + profileId);
            }

            //always copy over overlay wrapper
            dataAccess.copyResourceToUserData(null, "overlay.html", "");

            // Create the scripts folder if it doesn't exist
            if (
                !dataAccess.userDataPathExistsSync("/profiles/" + profileId + "/scripts")
            ) {
                logger.info("Can't find the scripts folder, creating one now...");
                dataAccess.makeDirInUserDataSync("/profiles/" + profileId + "/scripts");
            }

            // Create the controls folder if it doesn't exist.
            if (
                !dataAccess.userDataPathExistsSync("/profiles/" + profileId + "/mixplay")
            ) {
                logger.info("Can't find the mixplay folder, creating one now...");
                dataAccess.makeDirInUserDataSync("/profiles/" + profileId + "/mixplay");
            }

            // Create the chat folder if it doesn't exist.
            if (
                !dataAccess.userDataPathExistsSync("/profiles/" + profileId + "/chat")
            ) {
                logger.info("Can't find the chat folder, creating one now...");
                dataAccess.makeDirInUserDataSync("/profiles/" + profileId + "/chat");
            }

            // Create the currency folder if it doesn't exist.
            if (
                !dataAccess.userDataPathExistsSync("/profiles/" + profileId + "/currency")
            ) {
                logger.info("Can't find the currency folder, creating one now...");
                dataAccess.makeDirInUserDataSync("/profiles/" + profileId + "/currency");
            }

            // Create the fonts folder if it doesn't exist.
            if (
                !dataAccess.userDataPathExistsSync("/profiles/" + profileId + "/fonts")
            ) {
                logger.info("Can't find the fonts folder, creating one now...");
                dataAccess.makeDirInUserDataSync("/profiles/" + profileId + "/fonts");
            }

            // Create the events folder if it doesn't exist.
            if (!dataAccess.userDataPathExistsSync("/profiles/" + profileId + "/events")) {
                logger.info("Can't find the events folder, creating one now...");
                dataAccess.makeDirInUserDataSync("/profiles/" + profileId + "/events");
            }

            // Create the counters folder if it doesn't exist.
            if (!dataAccess.userDataPathExistsSync(`/profiles/${profileId}/counters`)) {
                logger.info("Can't find the counters folder, creating one now...");
                dataAccess.makeDirInUserDataSync(`/profiles/${profileId}/counters`);
            }

        }
    });

    logger.info(
        "Finished verifying default folder and files for all profiles, as well as making sure our logged in profile is valid."
    );
}

/**
 * This is called when Electron is finished initialization and is ready to create browser windows.
 * This is where we set global variables for custom scripts, start our backup manager, and start the api server.
 */
function appOnReady() {
    app.on("ready", async function() {
        await createDefaultFoldersAndFiles();

        //load mixer auth
        require("./backend/auth/auth-manager");
        const mixerAuth = require("./backend/auth/mixer-auth");
        mixerAuth.registerMixerAuthProviders();

        // load accounts
        const accountAccess = require("./backend/common/account-access");
        await accountAccess.updateAccountCache(false);

        const connectionManager = require("./backend/common/connection-manager");
        connectionManager.startOnlineCheckInterval();

        const timerManager = require("./backend/timers/timer-manager");
        timerManager.startTimers();

        const mixerClient = require("./backend/mixer-api/client");
        mixerClient.initClients();

        // load effects
        builtInEffectLoader.loadEffects();

        //load commands
        systemCommandLoader.loadCommands();

        //load event sources
        builtInEventSourceLoader.loadEventSources();

        //load event filters
        builtInEventFilterLoader.loadFilters();

        //load integrations
        integrationLoader.loadIntegrations();

        //load variables
        builtInVariableLoader.loadReplaceVariables();

        //load restrictions
        builtInRestrictionsLoader.loadRestrictions();

        fontManager.generateAppFontCssFile();

        const mixplayProjectManager = require("./backend/interactive/mixplay-project-manager");
        mixplayProjectManager.loadProjects();

        const eventsAccess = require("./backend/events/events-access");
        eventsAccess.loadEventsAndGroups();

        const customRolesManager = require("./backend/roles/custom-roles-manager");
        customRolesManager.loadCustomRoles();

        const effectQueueManager = require("./backend/effects/queues/effect-queue-manager");
        effectQueueManager.loadEffectQueues();

        const chatModerationManager = require("./backend/chat/moderation/chat-moderation-manager");
        chatModerationManager.load();

        const countersManager = require("./backend/counters/counter-manager");
        countersManager.loadCounters();

        const gamesManager = require("./backend/games/game-manager");
        gamesManager.loadGameSettings();

        const builtinGameLoader = require("./backend/games/builtin-game-loader");
        builtinGameLoader.loadGames();

        //get importer in memory
        require("./backend/import/v4/v4-importer");

        const { setupCommonListeners } = require("./backend/common/common-listeners");
        setupCommonListeners();

        createWindow();

        // These are defined globally for Custom Scripts.
        // We will probably wnat to handle these differently but we shouldn't
        // change anything until we are ready as changing this will break most scripts
        global.EffectType = Effect.EffectTypeV5Map;
        global.SCRIPTS_DIR = profileManager.getPathInProfile("/scripts/");

        backupManager.onceADayBackUpCheck();

        //start the REST api server
        webServer.start();

        const userDatabase = require("./backend/database/userDatabase");
        // Set users in user db to offline if for some reason they are still set to online. (app crash or something)
        userDatabase.setAllUsersOffline();

        return true;
    });
}
appOnReady();

/**
 * This is run when all windows are closed. It lets us unregister global hotkeys, run our last backup, and quit.
 */
function windowClosed() {
    app.on("window-all-closed", () => {
        // Unregister all shortcuts.
        let hotkeyManager = require("./backend/hotkeys/hotkey-manager");
        hotkeyManager.unregisterAllHotkeys();

        const userDatabase = require("./backend/database/userDatabase");
        userDatabase.setAllUsersOffline().then(() => {
            if (settings.backupOnExit()) {
                backupManager.startBackup(false, app.quit);

                // On OS X it is common for applications and their menu bar
                // to stay active until the user quits explicitly with Cmd + Q
            } else if (process.platform !== "darwin") {
                app.quit();
            }
        });
    });
}
windowClosed();

/**
 * TODO: Is this mac only?
 */
function appOnActivate() {
    app.on("activate", () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (mainWindow == null) {
            createWindow();
        }
    });
}
appOnActivate();

/**
 * Activated when quitting the app. This allows us to clean up our deleted profiles and log the shutdown.
 */
function onAppQuit() {
    app.on("quit", () => {
        const chatModerationManager = require("./backend/chat/moderation/chat-moderation-manager");
        chatModerationManager.stopService();
        deleteProfiles();
        renameProfile();
        logger.warn("THIS IS THE END OF THE SHUTDOWN PROCESS.");
    });
}
onAppQuit();