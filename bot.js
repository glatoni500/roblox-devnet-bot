require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');

// Configuración desde variables de entorno
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const VERIFICATION_CHANNEL_ID = process.env.VERIFICATION_CHANNEL_ID;
const ROBLOX_CLIENT_ID = process.env.ROBLOX_CLIENT_ID;
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const PORT = process.env.PORT || 3000;

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Servidor web para OAuth callback
const app = express();
const pendingVerifications = new Map();

client.once('ready', async () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    
    // Enviar mensaje de verificación al canal
    try {
        const channel = await client.channels.fetch(VERIFICATION_CHANNEL_ID);
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🔐 Verificación de Roblox')
            .setDescription('Bienvenido al servidor! Para acceder a todos los canales, necesitas verificar tu cuenta de Roblox.\n\n**¿Cómo funciona?**\n1. Haz clic en el botón "Verificar con Roblox"\n2. Serás redirigido a Roblox.com\n3. Autoriza la aplicación\n4. Vuelve automáticamente verificado\n\n✅ **100% Seguro** - Verificación oficial de Roblox')
            .setFooter({ text: 'Tu información se guarda de forma segura' });
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('verify_oauth_button')
                    .setLabel('Verificar con Roblox')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🔒')
            );
        
        await channel.send({ embeds: [embed], components: [row] });
        console.log('✅ Mensaje de verificación enviado');
    } catch (error) {
        console.error('❌ Error enviando mensaje de verificación:', error);
    }
});

// Manejar clicks en botones
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'verify_oauth_button') {
        // Verificar si ya está verificado
        const { data: existing } = await supabase
            .from('usuarios')
            .select('*')
            .eq('discord_id', interaction.user.id)
            .single();
        
        if (existing) {
            return interaction.reply({
                content: '✅ Ya estás verificado!',
                ephemeral: true
            });
        }
        
        // Generar state único para este usuario
        const state = `${interaction.user.id}_${Date.now()}`;
        pendingVerifications.set(state, {
            discordId: interaction.user.id,
            guildId: interaction.guild.id,
            timestamp: Date.now()
        });
        
        // Construir URL de OAuth2
        const authUrl = new URL('https://apis.roblox.com/oauth/v1/authorize');
        authUrl.searchParams.append('client_id', ROBLOX_CLIENT_ID);
        authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
        authUrl.searchParams.append('scope', 'openid profile');
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('state', state);
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🔗 Verificación en proceso')
            .setDescription('Haz clic en el botón de abajo para verificarte con Roblox.\n\n**Importante:** El enlace expira en 5 minutos.');
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setURL(authUrl.toString())
                    .setLabel('Ir a Roblox')
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('🚀')
            );
        
        await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });
    }
});

// Endpoint de callback OAuth2
app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code || !state) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .container {
                        text-align: center;
                        background: white;
                        padding: 40px;
                        border-radius: 20px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Error</h1>
                    <p>Parámetros inválidos. Intenta de nuevo desde Discord.</p>
                </div>
            </body>
            </html>
        `);
    }
    
    const verification = pendingVerifications.get(state);
    if (!verification) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .container {
                        text-align: center;
                        background: white;
                        padding: 40px;
                        border-radius: 20px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Error</h1>
                    <p>Sesión expirada o inválida. Intenta de nuevo desde Discord.</p>
                </div>
            </body>
            </html>
        `);
    }
    
    try {
        // Intercambiar code por token
        const tokenResponse = await axios.post('https://apis.roblox.com/oauth/v1/token', 
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: ROBLOX_CLIENT_ID,
                client_secret: ROBLOX_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        const accessToken = tokenResponse.data.access_token;
        
        // Obtener info del usuario
        const userResponse = await axios.get('https://apis.roblox.com/oauth/v1/userinfo', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        
        const robloxUser = userResponse.data;
        
        // Verificar si el Roblox ID ya está en uso
        const { data: existingRoblox } = await supabase
            .from('usuarios')
            .select('*')
            .eq('roblox_id', robloxUser.sub)
            .single();
        
        if (existingRoblox) {
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Error</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .container {
                            text-align: center;
                            background: white;
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>❌ Error</h1>
                        <p>Esta cuenta de Roblox ya está vinculada a otro usuario de Discord.</p>
                    </div>
                </body>
                </html>
            `);
        }
        
        // Guardar en base de datos
        await supabase
            .from('usuarios')
            .insert({
                discord_id: verification.discordId,
                roblox_id: robloxUser.sub,
                roblox_username: robloxUser.preferred_username,
                puntos_acumulados: 0,
                fecha_registro: new Date().toISOString()
            });
        
        // Asignar rol
        const guild = await client.guilds.fetch(verification.guildId);
        const member = await guild.members.fetch(verification.discordId);
        const role = guild.roles.cache.get(VERIFIED_ROLE_ID);
        
        if (role) {
            await member.roles.add(role);
        }
        
        // Enviar DM al usuario
        const user = await client.users.fetch(verification.discordId);
        const successEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ Verificación Exitosa')
            .setDescription(`Tu cuenta ha sido verificada!\n\n**Roblox:** ${robloxUser.preferred_username}\n**ID:** ${robloxUser.sub}\n\nYa puedes acceder a todos los canales!`)
            .setThumbnail(robloxUser.picture);
        
        await user.send({ embeds: [successEmbed] }).catch(() => {});
        
        pendingVerifications.delete(state);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Verificación Exitosa</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                    }
                    .container {
                        text-align: center;
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 20px;
                        backdrop-filter: blur(10px);
                    }
                    h1 { font-size: 48px; margin: 0 0 20px 0; }
                    p { font-size: 18px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>✅ ¡Verificado!</h1>
                    <p>Tu cuenta de Roblox ha sido vinculada exitosamente.</p>
                    <p>Puedes cerrar esta ventana y volver a Discord.</p>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Error en OAuth:', error);
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .container {
                        text-align: center;
                        background: white;
                        padding: 40px;
                        border-radius: 20px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Error</h1>
                    <p>Error durante la verificación. Intenta de nuevo.</p>
                </div>
            </body>
            </html>
        `);
    }
});

// Endpoint de health check
app.get('/', (req, res) => {
    res.send('🤖 Bot de Roblox Dev Network está corriendo!');
});

// Limpiar verificaciones expiradas cada 5 minutos
setInterval(() => {
    const now = Date.now();
    for (const [state, data] of pendingVerifications.entries()) {
        if (now - data.timestamp > 5 * 60 * 1000) { // 5 minutos
            pendingVerifications.delete(state);
        }
    }
}, 5 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`🌐 Servidor OAuth corriendo en puerto ${PORT}`);
});

client.login(DISCORD_TOKEN);
