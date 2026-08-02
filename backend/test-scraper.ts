import axios from 'axios';

async function testMobileApi(username: string) {
  try {
    console.log(`Testing i.instagram.com for @${username}...`);
    const res = await axios.get(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
      headers: {
        'User-Agent': 'Instagram 219.0.0.12.117 Android (29/10; 480dpi; 1080x2280; samsung; SM-G973F; beyond1; exynos9820; en_US; 341689536)',
        'X-IG-App-ID': '936619743392459',
        'X-IG-Capabilities': '3609Bw==',
        'X-IG-Connection-Type': 'WIFI',
        'Accept-Language': 'en-US',
      },
      timeout: 10000
    });

    console.log(`Mobile API Status: ${res.status}`);
    const user = res.data?.data?.user;
    console.log(`User found: ${user?.username}`);
    const media = user?.edge_owner_to_timeline_media?.edges || [];
    console.log(`Media items count: ${media.length}`);
    if (media.length > 0) {
      console.log('Sample item:', media[0].node.shortcode);
    }
  } catch (err: any) {
    console.error(`Mobile API Error: ${err.message}`);
    if (err.response) {
      console.log(`Status: ${err.response.status}, Data:`, JSON.stringify(err.response.data).slice(0, 200));
    }
  }
}

testMobileApi('bearhouseindia');
