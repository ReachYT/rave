import {Message} from 'discord.js'
import {discordInviteRegex} from "./Regex";
import {debug} from '../events/onMessage'
import {securityLevel, SecurityLevels} from "../utility/Settings";
import safeDeleteMessage from "../handlers/safe/SafeDeleteMessage";
import {Database} from "../database/Database";
import banForInviteSpam from "../actions/punishments/BanForInviteSpam";
import safeMessageUser from "../handlers/safe/SafeMessageUser";
import gb from "../misc/Globals";
import Watchlist from "../moderation/Watchlist";

export default function inviteListener(message : Message, database : Database, watchlist : Watchlist){
    if (message.author.id === gb.ownerID || message.member.hasPermission('ADMINISTRATOR')) return; // heh

    const sender :string = message.member.nickname || message.author.username;
    //TODO: Add telegram and whatsapp links in here as optional as well
    if (message.content.match(discordInviteRegex)){
        debug.warning(`${sender} in ${message.guild} sent an invite link.`);

        if (securityLevel === SecurityLevels.Dangerous) return;
        safeDeleteMessage(message).then(()=> {
            debug.info(`Deleted invite link from ${sender}`);
            return database.incrementMemberInviteStrikes(message.member)
        }).then((strikeCount : number) => {
            debug.silly(`${message.member.displayName} has ` + strikeCount + " strikes on record");
            // hardcoding but we shouldn't really need to change this for anything

            // user is in the watch list (joined within x seconds)
            //if (watchlist.getMember(message.member) !== undefined)


            if (strikeCount >= 5){
                banForInviteSpam(message.member);
            }
            else if (strikeCount === 4){
                safeMessageUser(message.member,
                    `Warning: you've posted 4 invites in ${message.guild.name}, the next one will get you banned.\n` +
                    `I don't go advertising in your server, so please don't do that in mine.`);
            }
        });
    }
}

