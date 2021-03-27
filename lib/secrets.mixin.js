/**
 * @license MIT, imicros.de (c) 2020 Andreas Leinen
 */
"use strict";

const _ = require("lodash");
const crypto = require("crypto");

module.exports = (options) => { return {
    
    /**
     * Service settings
     */
    settings: {},

    /**
     * Service metadata
     */
    metadata: {},

    /**
     * Service dependencies
     */
    //dependencies: [],	

    /**
     * Actions
     */
    actions: {},

    /**
     * Events
     */
    events: {},

    /**
     * Methods
     */
    methods: {

        async encrypt ({ ctx = null, object = null } = {}) {
            if ( !ctx || !object ) return null;
            
            let oek, cipheriv, iv;
            // get owner's encryption key
            try {
                oek = await this.getOek({ ctx: ctx });
            } catch (err) {
                throw new Error("failed to receive encryption keys");
            }
			// build secret
            let secret = crypto.createHash("SHA256")    // secret must be 256 bit long
				.update(oek.key)
				.digest();
			
            let map = (value /*,key*/) => {
                if (typeof value === "object" && value._encrypt) {
					// get initialization vector
                    iv = crypto.randomBytes(16);
					// create cipher
                    try {
                        cipheriv = crypto.createCipheriv("aes-256-cbc", secret, iv);
                    } catch (err) {
                        this.logger.warn("failed to create cypher",{ err: err });
                        throw new Error("failed to create cypher");
                    }
					// encrypt value
                    let encrypted = cipheriv.update(value._encrypt.value);
                    encrypted = Buffer.concat([encrypted, cipheriv.final()]);
                    return {
                        _encrypted: {
                            iv:	iv.toString("base64"),
                            oekId: oek.id,
                            value: encrypted.toString("base64")
                        }
                    };
                } else if (typeof value === "object") {
                    return _.mapValues(value, map);
                } else {
                    return value;
                }
            };
			
            // let output = _.cloneDeep(object);
            let output = _.mapValues(object, map);
            //let output = await this.visitor(output);
            return output;
			
        },

        async decrypt ({ ctx = null, object = null } = {}) {
            if ( !ctx || !object || typeof object !== "object") return null;
            
            let oek = {}, decipheriv;

			// iterate over object to get oekId from first encrypted vale
            let findOekId = (val) => {
                if (typeof val === "object" && val._encrypted) {
                    oek.id = val._encrypted.oekId;
                } else if (typeof val === "object") {
                    return _.mapValues(val, findOekId);
                }
            };
            await _.mapValues(object, findOekId);

			// get owner's encryption key
            try {
                oek = await this.getOek({ ctx: ctx, id: oek.id  });
            } catch (err) {
                throw new Error("failed to receive encryption keys");
            }
			// build secret
            let secret = crypto.createHash("SHA256")    // secret must be 256 bit long
				.update(oek.key)
				.digest();
			
            let map = (val /*,key*/) => {
                if (typeof val === "object" && val._encrypted) {
                    let iv = Buffer.from(val._encrypted.iv,"base64");
					// create decipher
                    try {
                        decipheriv = crypto.createDecipheriv("aes-256-cbc", secret, iv);
                    } catch (err) {
                        this.logger.warn("failed to create cypher",{ err: err });
                        throw new Error("failed to create cypher");
                    }
                    let encrypted = Buffer.from(val._encrypted.value, "base64");
                    let decrypted = decipheriv.update(encrypted);
                    decrypted = Buffer.concat([decrypted, decipheriv.final()]);
                    return decrypted.toString();
                } else if (typeof val === "object") {
                    return _.mapValues(val, map);
                } else {
                    return val;
                }
            };
			
            let output = await _.mapValues(object, map);
            return output;
			
        },

        async getOek ({ ctx = null, id = null } = {}) {
            
            let result = {};
            
            // try to retrieve from keys service
            let opts;
            if ( ctx ) opts = { meta: ctx.meta };
            let params = { 
                service: this.name
            };
            if ( id ) params.id = id;
            
            // call key service and retrieve keys
            try {
                result = await this.broker.call(this.keys.service + ".getOek", params, opts);
                this.logger.debug("Got key from key service", { id: id });
            } catch (err) {
                this.logger.error("Failed to receive key from key service", { params: params, meta: ctx.meta });
                throw err;
            }
            if (!result.id || !result.key) throw new Error("Failed to receive key from service", { result: result });
            return result;
        }
		
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        this.keys = {
            service: _.get(options, "service", "keys" )
        };    
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {},

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {}
    
};};