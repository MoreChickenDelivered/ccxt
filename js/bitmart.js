'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError, OrderNotFound, NetworkError } = require ('./base/errors');
const NodeRSA = require('node-rsa');

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
                'test': 'https://api-v2-testing-d8pvw98nl.bitmart.com',
            },
            'requiredCredentials': {
                'apiKey': true,
                'secret': true,
                'privateKey': true,
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
                        'token',
                        'orders',
                    ],
                    'delete': [
                        'orders/{id}',
                    ]
                },
            },
            'privateKey': null,
            'token': null,
            'timestamp': null,
            'fees': {
                'trading': {
                    'tierBased': false,
                    'percentage': true,
                    'maker': 0.05,
                    'taker': 0.05,
                },
                'funding': {
                    'tierBased': false,
                    'percentage': false,
                    'withdraw': {
                        'BTC': 0.0005,
                        'ETH': 0.01,
                        'BMX': 10,
                        'XLM': 0.001,
                        'MOBI': 0.001,
                        'EOS': 0.2,
                        'VEN': 1,
                        'ABT': 1,
                        'KAN': 15,
                        'OMG': 0.1,
                        'AISI': 0,
                        'ZRX': 3,
                        'IOST': 100,
                        'NEO': 0,
                        'EFX': 0,
                        'XRR': 10,
                        'ONT': 0.1,
                        'ZIL': 10,
                        'MKR': 0.005,
                        'GNT': 5,
                        'AE': 1,
                        'RHOC': 2,
                        'BTM': 5,
                        'BBK': 10,
                        'HYDRO': 500,
                        'DPST': 10,
                    },
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
            let [ base, quote ] = uppercase.split ('_');
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

    async fetchBalance (params = {}) {
        await this.getToken ();
        await this.loadMarkets ();
        let balances = await this.privateGetWallet ();
        let result = { 'info': balances };
        for (let b = 0; b < balances.length; b++) {
            let balance = balances[b];
            let currency = balance['id'];
            let account = {
              'free': parseFloat (balance['available']),
              'used': parseFloat (balance['frozen']),
              'total': 0.0,
            };
            account['total'] = account['free'] + account['used'];
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        await this.getToken ();
        await this.loadMarkets ();
        let response = await this.privateGetOrdersId (this.extend ({
            'id': id,
        }, params));
        return this.parseOrder (response);
    }

    async parseOrder (order) {
        let amount = this.safeFloat(order, 'original_amount');
        let remaining = this.safeFloat (order, 'remaining_amount');
        let filled = this.safeFloat (order, 'executed_amount');
        let price = this.safeFloat (order, 'price');
        let fee = this.safeFloat(order, 'fees');
        let status = 'open';
        if (order['status'] === 3) {
            status = 'closed';
        }
        else if (order['status'] === 4) {
            status = 'canceled';
        }
        return {
            'id': order['entrust_id'],
            'info': order,
            'timestamp': order['timestamp'],
            'datetime': this.iso8601 (order['timestamp']),
            'lastTradeTimestamp': undefined,
            'status': status,
            'symbol': order['symbol'],
            'type': 'limit',
            'side': order['side'],
            'price': price,
            'cost': price * filled,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'fee': fee,
        };
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.getToken ();
        await this.loadMarkets ();
        if (type === 'market')
            throw new ExchangeError (this.id + ' allows limit orders only');
        let order = {
            'symbol': this.marketId (symbol),
            'amount': amount,
            'price': price,
            'side': side,
        };
        let response = await this.privatePostOrders (this.extend(order, params));
        return {
            'info': response,
            'id': response['entrust_id'],
        };
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        await this.getToken ();
        await this.loadMarkets ();
        try {
            return await this.privateDeleteOrdersId ({'id': id});
        } catch (err) {
            if (err.message.includes ('500')) {
                throw new NetworkError ('Network Error');
            }
            throw new OrderNotFound ('Order Not Found');
        }
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = '/' + this.version + '/' + this.implodeParams (path, params);
        let query = this.omit (params, this.extractParams (path));
        if (api === 'public') {
            if (Object.keys (query).length)
              url += '?' + this.urlencode (query);
        } else {
            if (path.includes('token')) {
                headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
                if (Object.keys (query).length)
                    url += '?' + this.urlencode (query);
            }
            else {
                headers = {
                    'X-BM-TIMESTAMP': (new Date).getTime(),
                    'X-BM-AUTHORIZATION': 'Bearer ' + this.token,
                    'Content-Type': 'application/json',
                };
                if (method === 'POST') {
                    body = this.json(query);
                }
            }
        }
        url = this.urls['api'] + url;
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    encrypt(payload) {
        let key = new NodeRSA('-----BEGIN PRIVATE KEY-----\n' + this.privateKey + '\n-----END PRIVATE KEY-----');
        if(payload) {
            return key.encryptPrivate(payload, 'base64');
        } else {
            return key.encryptPrivate(this.apiKey + ':' + this.secret + ':' + new Date().getTime(), 'base64');
        }
    }

    async getToken () {
        if (this.timestamp && this.token) {
            let previous = this.timestamp.getTime() / 1000;
            let now = new Date ().getTime() / 1000;
            if (now - previous < 896) {
                return this.token;
            }
        }
        let tokenRequest = {
            'grant_type': 'client_credentials',
            'client_id': this.apiKey,
            'client_secret': this.encrypt()
        };
        let res = await this.privatePostToken (tokenRequest);
        this.timestamp = new Date ();
        this.token = res.access_token;
    }
};
