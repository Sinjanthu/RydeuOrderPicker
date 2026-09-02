import axios from 'axios';

export async function notifyDiscord(order) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn('⚠️  DISCORD_WEBHOOK_URL not set');
    return;
  }

  try {
    const embed = {
      title: '🚗 New Rydeu Order Request',
      description: `${order.pickupLocation || '?'} → ${order.dropLocation || '?'}`,
      fields: [
        { name: 'Request ID', value: order.id || 'N/A', inline: true },
        { name: 'Transfer Date', value: order.transferDate || 'N/A', inline: true },
        { name: 'Distance', value: order.distanceKm ? `${order.distanceKm} km` : 'N/A', inline: true },
        { name: 'Passengers/Baggage', value: order.passengers || 'N/A', inline: false },
        { name: 'Transfer Type', value: order.transferType || 'N/A', inline: true },
        { name: 'Vehicle Type', value: order.vehicleType || 'N/A', inline: true },
      ],
      color: 0x1e90ff, // Dodger blue
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Rydeu Order Picker',
        icon_url: 'https://rydeu.com/favicon.ico',
      },
    };

    await axios.post(webhookUrl, {
      embeds: [embed],
      username: 'Rydeu Order Bot',
    });

    console.log(`✓ Discord notification sent for order ${order.id}`);
  } catch (err) {
    console.error('Discord notification failed:', err.message);
  }
}

export async function notifyDiscordBatch(orders) {
  if (orders.length === 0) return;

  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    for (const order of orders) {
      await notifyDiscord(order);
      // Rate limit: wait a bit between messages
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error('Batch notification failed:', err.message);
  }
}
