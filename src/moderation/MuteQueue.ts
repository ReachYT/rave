import * as Discord from 'discord.js'
import * as dbg from "debug";
import {DiscordAPIError, Guild, GuildMember, Role, User} from "discord.js";
import {getMuteTime, raidDetectionInterval} from "../utility/Settings";
import Timer = NodeJS.Timer;
import {log, debug} from "../utility/Logging";
import {Moment} from "moment";
import moment = require("moment");
import raidMode from "../actions/RaidMode";
import {Database} from "../database/Database";
import muteUser from "../actions/punishments/MuteUser";
import safeBanUser from "../handlers/safe/SafeBanUser";
import gb from "../misc/Globals";
import {advertiseOnRaidBan} from "../interfaces/Replies";
import {formattedTimeString} from "../utility/Util";
import {Offense} from "./interfaces";


class MutedMember  {
    member : Discord.GuildMember;
    muteQueue : MuteQueue;
    name : string;
    muteDate : Date;
    unmuteDate : Date;
    role : Discord.Role;
    unmuteSeconds ?: number;
    timeout ?: Timer;
    muted : boolean;

    constructor(member : Discord.GuildMember, role : Discord.Role, unmuteDate : Date, muteQueue: MuteQueue){
        this.member = member;
        this.name = member.nickname || member.user.username; // this can change but we don't care
        this.muteDate = new Date();
        this.unmuteDate = unmuteDate;
        this.role = role;
        this.muteQueue = muteQueue;
        this.muted = false;
        this.muteUser();
    }

    private muteUser(){
        // TODO: fix this seconds only thing
        muteUser(this.member, this.role, Offense.Spam,true).then(muted => {
            this.muted = muted;
        });
    }
    public cancelUnmute(){
        if (this.timeout === undefined)
            return debug.error(`Could not cancel scheduled unmute for ${this.name}, user has no scheduled unmute date`, "MuteQueue");
        clearTimeout(this.timeout);
    }
}

export class MuteQueue {
    queue : Map<string, MutedMember[]>;
    //  group of raiders, currently not functioning
    raiders : Map<string, MutedMember[]>;
    constructor(){
        this.queue = new Map<string, MutedMember[]>();
        this.raiders = new Map<string, MutedMember[]>();
        debug.info('MuteQueue is ready.', "MuteQueue");
    }

    private sortGuild(guildId: string){
        const arr: MutedMember[] | undefined = this.queue.get(guildId);
        if (!arr){
            const guild = gb.instance.bot.guilds.get(guildId);
            debug.error(`Tried to sort a guild not registered in the muteQueue\nName:${guild ? guild.name: 'unknown guild'}`);
            return;
        }
        // This will sort the users based on their unmute date with the ones that have shorter time
        // being closer to the end of the array
        this.queue.set(guildId, arr.sort((a: MutedMember, b:MutedMember) => {
            if (a.unmuteDate < b.unmuteDate){
                return 1;
            }
            return -1;
        }));
    }

    /**
     * Adds user to the muteQueue
     * @param {GuildMember} member
     * @param {Role} role
     * @param {Date} unmuteDate
     * @param {number} duration - in seconds
     */
    public add(member : GuildMember, role : Role, unmuteDate : Date, duration?: number) : boolean {
        let guild : MutedMember[] | undefined = this.queue.get(member.guild.id);

        console.log(guild);
        if (guild !== undefined) {
            const muted: MutedMember | undefined = guild.find(muted=> muted.member.id === member.id);
            if (muted) {
                debug.info(`Tried to mute ${muted.member.user.username} but they were already muted`);
                return false;
            }

            let mutedMember : MutedMember = new MutedMember(member, role, unmuteDate, this);
            // is false when we couldn't mute the user
            if (!mutedMember.muted) {
                debug.warning(`Could not mute user ${member.user.username}`);
                return false;
            }
            guild.push(mutedMember);
        }
        else {
            let mutedMember : MutedMember = new MutedMember(member, role, unmuteDate, this);

            if (!mutedMember.muted){
                debug.warning(`Could not mute user ${member.user.username}`);
                return false;
            }
            this.queue.set(member.guild.id, [mutedMember]);
            guild = this.queue.get(member.guild.id)!;
        }
        if (guild.length > 1)
            this.sortGuild(member.guild.id);
        this.scheduleUnmute(member, duration);
        return true;
    }

    public getMutedUserCount(guild : Discord.Guild) : number {
        const members : MutedMember[] | undefined = this.queue.get(guild.id);
        if (members !== undefined)
            return members.length;
        else
            return 0;
    }

    public insertNewGuild(guild : Discord.Guild){
        if (this.queue.get(guild.id) === undefined){
            this.queue.set(guild.id, []);
        }
    }
    public release(members: GuildMember | GuildMember[]) : void {
        if (!Array.isArray(members))
            members = [members];

        for (let i = members.length; i > 0; --i){
            const guild = this.queue.get(members[i].guild.id);
            if (!guild) {
                debug.info(`User ${members[i].user.username} in MuteQueue could not be found`);
                continue;
            }
            const targetId = members[i].id;
            guild.splice(guild.findIndex(muted => muted.member.id === targetId), 1);
        }
    }

    public getUser(guild: Guild, member:GuildMember|User): MutedMember | undefined {
        const targetGuild = this.queue.get(guild.id);
        if (!targetGuild)
            return undefined;
        return targetGuild.find(muted => muted.member.id === member.id);
    }

    public detectRaid(member: Discord.GuildMember){
        const members : MutedMember[] | undefined  =this.queue.get(member.guild.id);
        if (members === undefined) return;

        //const raidStatus = database.getRaids
        const muteDates = members.map((user : MutedMember) => user.muteDate);
        const recentlyMuted : Date[] = muteDates.filter((date : Date)=>
            date > moment(date).subtract(raidDetectionInterval).toDate()
        );
        if (recentlyMuted.length > 5){
            //raidMode()
        }
    }

    public scheduleUnmute(member : Discord.GuildMember, duration?: number){
        const members : MutedMember[] | undefined  =this.queue.get(member.guild.id);

        if (members === undefined)
            return debug.warning(`Guild for ${member.nickname} was not found`, 'MuteQueue');

        const mutedGuildMember: MutedMember | undefined = members.pop();

        if (!mutedGuildMember)
            return debug.error(`Tried fetching a member from the empty muteQueue of ${member.guild.name}`, 'muteQueue');

        // in seconds
        let timeDelta : number = duration ? duration : getMuteTime();
        const timeFormat = formattedTimeString(timeDelta);

        debug.silly(`${timeFormat} recorded as timeDelta for ${mutedGuildMember.name}`);

        const timeoutId : Timer = setTimeout(() => {
            // index could have changed by the time this is scheduled to run
            const timeoutMembers : MutedMember[] | undefined  = this.queue.get(member.guild.id);

            if (!timeoutMembers)
                return;
            else if (!mutedGuildMember.role) {
                return void debug.warning(`Tried to unmute ${mutedGuildMember.name} but they were already unmuted.\n`, "MuteQueue");
            }

            mutedGuildMember.member.removeRole(mutedGuildMember.role, `End of ${timeFormat} mute.`).catch((error: Error) => {
                if (error instanceof DiscordAPIError){
                    return void debug.error(`Tried to unmute ${mutedGuildMember.name} but they were already unmuted.\n` + error, "MuteQueue");
                }
                return void debug.error(`Unexpected error while unmuting ${mutedGuildMember.name}.` + error, 'MuteQueue');
            });
            debug.info(`${mutedGuildMember.name} in ${mutedGuildMember.member.guild.name} was unmuted after ${timeFormat}.`, "MuteQueue");
        }, timeDelta * 1000);

        mutedGuildMember.timeout = timeoutId;

    }

    public clearRaiders(message: Discord.Message) {
        const guild = message.guild;
        const raidGuild: MutedMember[] | undefined= this.queue.get(guild.id);
        if (!raidGuild)
            return debug.error(`No guild found for ${message.guild.name}`, 'muteQueue');
        const youTried = gb.emojis.get('alexa_you_tried');
        const raiderCount = raidGuild.length;

        if (!raidGuild)
            return debug.error(`Tried clearing raiders in an non - existent guild ${guild.name}.`);

        for (let i = raidGuild.length; i > 0; --i){
            const raider = raidGuild[i];
            if (raider.member.hasPermission('ADMINISTRATOR')){
                debug.warning(`Tried to autoban an admin for raiding in ${guild.name}`);
                continue;
                // TODO: Post a warning in the warning channel for this later
            }
            safeBanUser(raider.member,
                `Mass banned by ${message.author.username}`,
                `You were mass banned by a mod for raiding ${youTried}\n${advertiseOnRaidBan}`);
            raidGuild.splice(i, 1);

            // we also need to remove them from the database when we implement that
        }
        message.channel.send(`Banned ${raiderCount - raidGuild.length} muted raiders. ${youTried}`)
    }
}