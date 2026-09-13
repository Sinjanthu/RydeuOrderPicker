import axios from 'axios';

async function sendEmbed(embed) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn('⚠️  DISCORD_WEBHOOK_URL not set');
    return;
  }

  try {
    await axios.post(webhookUrl, {
      embeds: [{
        timestamp: new Date().toISOString(),
        footer: { text: 'Rydeu Order Picker', icon_url: 'https://rydeu.com/favicon.ico' },
        ...embed,
      }],
      username: 'Rydeu Order Bot',
    });
  } catch (err) {
    console.error('Discord notification failed:', err.message);
  }
}

export async function notifyDiscord(order) {
  await sendEmbed({
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
  });
  console.log(`✓ Discord notification sent for order ${order.id}`);
}

export async function notifyDiscordBatch(orders) {
  if (orders.length === 0) return;
  for (const order of orders) {
    await notifyDiscord(order);
    // Rate limit: wait a bit between messages
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function notifyAuctionAccepted(auction, isNight) {
  await sendEmbed({
    title: isNight ? '🌙 Night Auction Accepted (23:00–05:00)' : '🎯 Auction Accepted',
    description: `${auction.pickupLocation || '?'} → ${auction.dropLocation || '?'}`,
    fields: [
      { name: 'Request ID', value: auction.id || 'N/A', inline: true },
      { name: 'Transfer Date', value: auction.transferDate || 'N/A', inline: true },
      { name: 'Distance', value: auction.distanceKm ? `${auction.distanceKm} km` : 'N/A', inline: true },
      { name: 'Passengers/Baggage', value: auction.passengers || 'N/A', inline: false },
      { name: 'Transfer Type', value: auction.transferType || 'N/A', inline: true },
    ],
    color: isNight ? 0x8a2be2 : 0x2ecc71, // purple for night, green otherwise
  });
  console.log(`✓ Discord notification sent for accepted auction ${auction.id}`);
}

export async function notifyAuctionFailed(auction, reason) {
  await sendEmbed({
    title: '⚠️ Auction Auto-Accept Failed — Manual Action Needed',
    description: `${auction.pickupLocation || '?'} → ${auction.dropLocation || '?'}`,
    fields: [
      { name: 'Request ID', value: auction.id || 'N/A', inline: true },
      { name: 'Transfer Date', value: auction.transferDate || 'N/A', inline: true },
      { name: 'Reason', value: reason ? reason.substring(0, 1024) : 'Unknown error', inline: false },
    ],
    color: 0xe74c3c, // red
  });
  console.log(`✓ Discord failure notification sent for auction ${auction.id}`);
}

// API-based equivalent of notifyAuctionNeedsManualStep below: same "found a
// new auction, accept it yourself" purpose, but there's no browser screen to
// screenshot anymore since this comes straight from the bookingRequest API.
// Vehicle type/accept still isn't automatable - that endpoint hasn't been
// found yet - so this stays a heads-up, not an action.
export async function notifyAuctionFound(auction, isNight) {
  await sendEmbed({
    title: isNight
      ? '🌙 Night Auction (23:00–05:00) — Manual Accept Needed'
      : '🎯 New Auction — Manual Accept Needed',
    description: `${auction.pickupLocation || '?'} → ${auction.dropLocation || '?'}`,
    fields: [
      { name: 'Request ID', value: auction.id || 'N/A', inline: true },
      { name: 'Transfer Date', value: auction.transferDate || 'N/A', inline: true },
      { name: 'Distance', value: auction.distanceKm ? `${auction.distanceKm} km` : 'N/A', inline: true },
      { name: 'Passengers/Baggage', value: auction.passengers || 'N/A', inline: false },
      { name: 'Transfer Type', value: auction.transferType || 'N/A', inline: true },
      ...(auction.price ? [{ name: 'Price', value: `${auction.price}`, inline: true }] : []),
      { name: 'Note', value: 'Vehicle selection + accept still has to be done manually in the app - that part of the API hasn\'t been mapped yet.', inline: false },
    ],
    color: isNight ? 0x8a2be2 : 0xf39c12, // purple for night, amber otherwise
  });
  console.log(`✓ Discord notification sent for auction ${auction.id}`);
}

// Used when we've reached a screen we've never verified (e.g. a details/
// accept flow requiring a vehicle pick) — rather than guess-click through
// something that could commit to a real booking, send a screenshot so a
// human can act on it directly, image attached so it's visible immediately
// on mobile without opening a separate log.
export async function notifyAuctionNeedsManualStep(auction, screenshotBuffer, isNight) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('⚠️  DISCORD_WEBHOOK_URL not set');
    return;
  }

  const embed = {
    title: isNight
      ? '🌙📸 Night Auction (23:00–05:00) — Manual Accept Needed'
      : '📸 Auction Needs Manual Step — Unverified Screen',
    description: `${auction.pickupLocation || '?'} → ${auction.dropLocation || '?'}`,
    fields: [
      { name: 'Request ID', value: auction.id || 'N/A', inline: true },
      { name: 'Transfer Date', value: auction.transferDate || 'N/A', inline: true },
      { name: 'Note', value: 'Opened "View Details" — the accept + vehicle-select flow past this point is unverified, so this needs a manual tap in the app.', inline: false },
    ],
    color: isNight ? 0x8a2be2 : 0xf39c12, // purple for night, amber otherwise
    timestamp: new Date().toISOString(),
    footer: { text: 'Rydeu Order Picker', icon_url: 'https://rydeu.com/favicon.ico' },
    image: { url: 'attachment://screenshot.png' },
  };

  try {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ embeds: [embed], username: 'Rydeu Order Bot' }));
    form.append('files[0]', new Blob([screenshotBuffer], { type: 'image/png' }), 'screenshot.png');

    const res = await fetch(webhookUrl, { method: 'POST', body: form });
    if (!res.ok) {
      console.error('Discord screenshot notification failed:', res.status, await res.text());
    } else {
      console.log(`✓ Discord screenshot notification sent for auction ${auction.id}`);
    }
  } catch (err) {
    console.error('Discord screenshot notification failed:', err.message);
  }
}
