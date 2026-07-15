import axios from 'axios';
import { env } from '../config/env';

export class MetaService {
  private static readonly GRAPH_API_URL = 'https://graph.facebook.com/v19.0';

  /**
   * Generates the OAuth URL to redirect the user to Meta
   */
  static getOAuthUrl(state: string): string {
    const redirectUri = encodeURIComponent(env.FACEBOOK_REDIRECT_URI);
    const scope = encodeURIComponent('instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement');
    return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${env.FACEBOOK_APP_ID}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}`;
  }

  /**
   * Exchanges authorization code for an access token
   */
  static async getAccessToken(code: string): Promise<string> {
    const url = `${this.GRAPH_API_URL}/oauth/access_token`;
    const response = await axios.get(url, {
      params: {
        client_id: env.FACEBOOK_APP_ID,
        client_secret: env.FACEBOOK_APP_SECRET,
        redirect_uri: env.FACEBOOK_REDIRECT_URI,
        code
      }
    });
    return response.data.access_token;
  }

  /**
   * Exchanges a short-lived token for a long-lived one
   */
  static async getLongLivedToken(shortLivedToken: string): Promise<string> {
    const url = `${this.GRAPH_API_URL}/oauth/access_token`;
    const response = await axios.get(url, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: env.FACEBOOK_APP_ID,
        client_secret: env.FACEBOOK_APP_SECRET,
        fb_exchange_token: shortLivedToken
      }
    });
    return response.data.access_token;
  }

  /**
   * Gets the Facebook Pages managed by the user
   */
  static async getPages(accessToken: string): Promise<any[]> {
    const url = `${this.GRAPH_API_URL}/me/accounts`;
    const response = await axios.get(url, {
      params: { access_token: accessToken }
    });
    return response.data.data;
  }

  /**
   * Gets the Instagram Business Account linked to a Facebook Page
   */
  static async getInstagramAccount(pageId: string, pageAccessToken: string): Promise<any> {
    const url = `${this.GRAPH_API_URL}/${pageId}`;
    const response = await axios.get(url, {
      params: {
        fields: 'instagram_business_account{id,username,profile_picture_url}',
        access_token: pageAccessToken
      }
    });
    return response.data.instagram_business_account;
  }
}
