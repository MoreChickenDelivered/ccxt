'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class bitmart extends Exchange {
  describe () {
    return this.deepExtend (super.describe (), {
      'id': 'bitmart',
      'name': 'Bitmart',
      'countries': 'US',
      'rateLimit': 1000,
      'version': 'v2',
      'urls': {
        'logo': 'https://www.bitmart.com/_nuxt/img/logo1.ed5c199.png',
        'api': 'https://openapi.bitmart.com',
        'www': 'https://www.bitmart.com',
        'doc': [
          'https://github.com/bitmartexchange/bitmart-official-api-docs',
        ],
      },
      'api': {
        'public': {
          'get': [
            'symbols',
            'symbols/{pair}/orders',
          ],
        },
        'private': {
          'get': [
            'wallet',
            'orders/{id}',
          ],
          'post': [
            'orders',
          ],
          'delete': [
            'orders/{id}',
          ]
        },
      },
    });
  }

  async fetchMarkets () {
    let markets = await this.publicGetSymbols ();
    let result = [];
    for (let p = 0; p < markets.length; p++) {
      let id = markets[p];
      let uppercase = id.toUpperCase ();
      let [ quote, base ] = uppercase.split ('_');
      let symbol = base + '/' + quote;
      result.push ({
        'id': id,
        'symbol': symbol,
        'base': base,
        'quote': quote,
        'info': id,
      });
    }
    return result;
  }

  async fetchOrderBook (symbol, limit = undefined, params = {}) {
    await this.loadMarkets ();
    let precision = symbol.includes('USDT') ? 2 : 6;
    let orderbook = await this.publicGetSymbolsPairOrders (this.extend ({
      'pair': this.marketId (symbol),
      'precision': precision,
    }, params));
    return this.parseOrderBook (orderbook, undefined, 'buys', 'sells', 'price', 'amount');
  }

  sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
    let url = '/' + this.version + '/' + this.implodeParams (path, params);
    let query = this.omit (params, this.extractParams (path));
    if (api === 'public') {
      if (Object.keys (query).length)
        url += '?' + this.urlencode (query);
    } /* else {
      this.checkRequiredCredentials ();
      let nonce = this.nonce ();
      let request = this.extend ({
        'request': url,
        'nonce': nonce,
      }, query);
      let payload = this.json (request);
      payload = this.stringToBase64 (this.encode (payload));
      let signature = this.hmac (payload, this.encode (this.secret), 'sha384');
      headers = {
        'X-BM-TIMESTAMP': 'xxx',
        'X-BM-AUTHORIZATION': 'xxx',
      };
    } */
    url = this.urls['api'] + url;
    return { 'url': url, 'method': method, 'body': body, 'headers': headers };
  }
};
