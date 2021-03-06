/**
 * @license MIT, imicros.de (c) 2019 Andreas Leinen
 */
"use strict";

const _ = require("lodash");
const { PassThrough, Readable } = require("stream");

class ReadableObjectStream extends Readable {
    constructor(obj) {
        super();
        if (typeof obj === "object") {
            this.str = JSON.stringify(obj);
        } else if (typeof obj === "string") {
            this.str = obj;
        } else {
            this.str = "";
        }
        this.sent = false;
    }

    _read() {
        if (!this.sent) {
            this.push(Buffer.from(this.str));
            this.sent = true;
        }
        else {
            this.push(null);
        }
    }
}

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

        async getStream ({ ctx = null, objectName = null } = {}) {
            if ( !ctx || !objectName ) return null;
            
            let opts = { meta: ctx.meta };
            
            // call file service
            let params = {
                objectName: objectName
            };
            try {
                let stream = await this.broker.call(this.minio.service + ".getObject", params, opts);
                return stream;            
            } catch (err) {
                /* istanbul ignore next */
                {
                    this.logger.debug(`Failed to retrieve object ${objectName}`, { objectName: objectName });
                    throw err;
                }
            }
        },

        async pipeStream ({ ctx = null, objectName = null } = {}) {
            if ( !ctx || !objectName ) return null;
            
            let opts = { meta: ctx.meta };
            opts.meta.store = {
                objectName: objectName      
            };
            
            let passThrough = new PassThrough();
            
            // call file service
            try {
                this.broker.call(this.minio.service + ".putObject", passThrough, opts);
                return passThrough;            
            } catch (err) {
                /* istanbul ignore next */
                {
                    this.logger.debug(`Failed to write object ${objectName}`, { objectName: objectName });
                    throw err;
                }
            }
        },

        async putStream ({ ctx = null, objectName = null, stream = null } = {}) {
            if ( !ctx || !objectName || !stream ) return null;
            
            let opts = { meta: ctx.meta };
            opts.meta.store = {
                objectName: objectName      
            };
            
            // call file service
            try {
                let result = await this.broker.call(this.minio.service + ".putObject", stream, opts);
                return result;
            } catch (err) {
                /* istanbul ignore next */
                {
                    this.logger.debug(`Failed to write object ${objectName}`, { objectName: objectName });
                    throw err;
                }
            }
        },

        async putString ({ ctx = null, objectName = null, value = null } = {}) {
            if ( !ctx || !objectName || !value ) return null;
            
            let opts = { meta: ctx.meta };
            opts.meta.store = {
                objectName: objectName      
            };
            
            // create stream from string
            let stream = Readable.from(value);
          
            // call file service
            try {
                let result = await this.broker.call(this.minio.service + ".putObject", stream, opts);
                return result;
            } catch (err) {
                /* istanbul ignore next */
                {
                    this.logger.debug(`Failed to write object ${objectName}`, { objectName: objectName });
                    throw err;
                }
            }
        },
      
        async getString ({ ctx = null, objectName = null } = {}) {
            if ( !ctx || !objectName ) return null;
            
            let opts = { meta: ctx.meta };
            
            function streamToString (stream) {
                const chunks = [];
                return new Promise((resolve, reject) => {
                    stream.on("data", chunk => chunks.push(chunk));
                    stream.on("error", reject);
                    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                });
            }
          
            // call file service
            let params = {
                objectName: objectName
            };
            try {
                let stream = await this.broker.call(this.minio.service + ".getObject", params, opts);
                return await streamToString(stream);            
            } catch (err) {
                /* istanbul ignore next */
                {
                    this.logger.debug(`Failed to retrieve object ${objectName}`, { objectName: objectName });
                    throw err;
                }
            }
        },

        async putObject ({ ctx = null, objectName = null, value = null } = {}) {
            if ( !ctx || !objectName || !value || typeof value !== "object" ) return null;
            
            let opts = { meta: ctx.meta };
            opts.meta.store = {
                objectName: objectName      
            };
            
            // create stream from string
            // this.logger.debug("Readable:", { readable: Readable });
            // let stream = Readable.from(JSON.stringify(value));
            let stream = new ReadableObjectStream(value);
			
            // call file service
            try {
                let result = await this.broker.call(this.minio.service + ".putObject", stream, opts);
                return result;
            } catch (err) {
                /* istanbul ignore next */
                {
                    this.logger.debug(`Failed to write object ${objectName}`, { objectName: objectName });
                    throw err;
                }
            }
        },
      
        async getObject ({ ctx = null, objectName = null } = {}) {
            if ( !ctx || !objectName ) return null;
            
            let opts = { meta: ctx.meta };
            
            function streamToString (stream) {
                const chunks = [];
                return new Promise((resolve, reject) => {
                    stream.on("data", chunk => chunks.push(chunk));
                    stream.on("error", reject);
                    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                });
            }
          
            // call file service
            let params = {
                objectName: objectName
            };
            try {
                let stream = await this.broker.call(this.minio.service + ".getObject", params, opts);
                let s =  await streamToString(stream);
                return JSON.parse(s);
            } catch (err) {
                /* istanbul ignore next */
                {
                    this.logger.debug(`Failed to retrieve object ${objectName}`, { objectName: objectName });
                    throw err;
                }
            }
        }
        
    },

    /**
     * Service created lifecycle event handler
     */
    created() {
        this.minio = {
            service: _.get(options, "service", "minio" )
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