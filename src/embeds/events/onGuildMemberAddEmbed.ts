import * as Discord from "discord.js";
import {GuildMember} from "discord.js";
export default function guildMemberAddEmbed(member: GuildMember, welcomeMessage: string){
    return new Discord.RichEmbed()
        .setThumbnail(member.user.displayAvatarURL)
        .setColor("GREEN")
        .setTitle(`${member.user.username} has joined the server!`)
        .setDescription(welcomeMessage)
        .setTimestamp()
}