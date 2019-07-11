/**
 * @license MIT, imicros.de (c) 2019 Andreas Leinen
 *
 * @source https://docs.min.io/docs/javascript-client-api-reference.html
 * @source stream handling based on https://medium.com/@brandonstilson/lets-encrypt-files-with-node-85037bea8c0e
 *
 */
"use strict";

const _ = require("lodash");
const Minio = require("minio");
const crypto = require("crypto");
const zlib = require("zlib");
const { AclMixin } = require("imicros-acl");

const { Transform } = require("stream");

class AppendInitVect extends Transform {
    constructor(iv, oekId, opts) {
        super(opts);
        this.iv = iv;
        this.oekId = oekId;
        this.appended = false;
    }

    _transform(chunk, encoding, cb) {
        if (!this.appended) {
            this.push(this.iv);             // iv with fixed length 16
            let buf = Buffer.alloc(100);    // oek id with fixed length 100
            buf.write(this.oekId);
            this.push(buf);
            this.appended = true;
        }
        this.push(chunk);
        cb();
    }
}

/** Actions */
// action makeBucket { region } => { bucketName, region }
// action removeBucket { } => { bucketName, region }
// action putObject { ReadableStream } => { bucketName, objectName }
// action getObject { objectName } => { ReadableStream }
// action removeObject { objectName } => { bucketName, objectName }
// action removeObjects { objectsList } => true | Error
// action statObject { objectName } => { stat }
// action listObjects { prefix, recursive, startAfter} => { ReadableStream obj }
// action listObjectsArray { prefix, recursive, startAfter} => [ obj ]
// action listBuckets { } => [ bucket ]    only for admin service

module.exports = {
    name: "imicros.minio",
    
    mixins: [AclMixin],
    
    /**
     * Service settings
     */
    settings: {
        /*
        keysService: "keys",
        adminGroup: ["uid of admin group"]
        */        
    },

    /**
     * Service metadata
     */
    metadata: {},

    /**
     * Service dependencies
     */
    //dependencies: ["keys"],	

    /**
     * Actions
     */
    actions: {

        /**
         * Create bucket for the current group
         * 
         * @actions
         * @param {string} region - The region to create the bucket in. Defaults to "eu-central-1"
         * 
         * @meta
         * @param {string} acl.owner.id - object owner => bucket name
         *
         * @returns {Object} bucketName, region
         */
        makeBucket: {
            params: {
                region: {type: "string", optional: true}
            },			
            async handler(ctx) {
                if (!await this.isAuthorized({ ctx: ctx, ressource: {}, action: "makeBucket" })) throw new Error("not authorized");
                let owner = this.getOwnerId({ ctx: ctx, abort: true });

                let bucketName = owner;
                let region = ctx.params.region ? ctx.params.region : this.region;

                try {
                    let exists = await this.client.bucketExists(bucketName);
                    if (exists) throw new Error("Bucket already exsits");
                    await this.client.makeBucket(bucketName, region);
                    this.logger.info("Bucket created successfully", { bucketName: bucketName, region: region });
                } catch (err) {
                    return this.logger.warn("Error creating bucket.", { bucketName: bucketName, region: region, err:err.message });
                }
                return { bucketName: bucketName, region: region };
            }
        }, 
        
        /**
         * Remove bucket of current group
         * 
         * @actions
         * @param -
         * 
         * @meta
         * @param {string} acl.owner.id - object owner => bucket name
         *
         * @returns {object} bucketName
         */
        removeBucket: {
            async handler(ctx) {
                if (!await this.isAuthorized({ ctx: ctx, ressource: {}, action: "removeBucket" })) throw new Error("not authorized");
                let owner = this.getOwnerId({ ctx: ctx, abort: true });

                let bucketName = owner;

                try {
                    let exists = await this.client.bucketExists(bucketName);
                    if (!exists) throw new Error("Bucket doesn't exsits");
                    await this.client.removeBucket(bucketName);
                    this.logger.info("Bucket removed successfully", { bucketName: bucketName });
                } catch (err) {
                    return this.logger.warn("Error removing bucket.", { bucketName: bucketName, err: err });
                }
                return { bucketName: bucketName };
            }
        }, 
        
        
        /**
         * upload an object from a stream/buffer
         * 
         * @actions
         * @param {ReadableStream} params - Readable stream
         *
         * @meta
         * @param {string} store.objectName - Name of the object
         * @param {number} store.size - Size of the object (optional).
         * @param {object} store.metaData - metaData of the object (optional).
         * 
         * @returns {object} bucketName, objectName
         */
        putObject: {
            async handler(ctx) {
                let owner = this.getOwnerId({ ctx: ctx, abort: true });

                let params = {
                    bucketName: owner,
                    objectName: _.get(ctx.meta,"store.objectName",_.get(ctx.meta,"fieldname",_.get(ctx.meta,"filename"))),
                    metaData: _.get(ctx.meta,"store.metaData",{})
                };
                if (!params.objectName) {
                    this.logger.warn("missing filename", ctx.meta);
                    throw new Error("missing filename");
                }

                if (!await this.isAuthorized({ ctx: ctx, ressource: params, action: "putObject" })) throw new Error("not authorized");
                
                let oek, cipheriv, iv;
                // get owner's encryption key
                try {
                    oek = await this.getKey({ ctx: ctx });
                } catch (err) {
                    throw new Error("failed to receive encryption keys");
                }
                
                // create cypher
                try {
                    let secret = crypto.createHash("SHA256")    // secret must be 256 bit long
                        .update(oek.key)
                        .digest();
                    iv = crypto.randomBytes(16);
                    cipheriv = crypto.createCipheriv("aes-256-cbc", secret, iv);
                } catch (err) {
                    this.logger.warn("failed to create cypher",{ err: err });
                    throw new Error("failed to create cypher");
                }
                
                // add encryption information to meta data
                params.metaData["x-amz-meta-iv"] = iv.toString("base64");
                params.metaData["x-amz-meta-oek"] = oek.id;
                
                // create transform stream for iv
                let appendInitVect = new AppendInitVect(iv, oek.id);
                
                // create gzip stream
                let gzip = zlib.createGzip();
                
                try {
                    await this.client.putObject(
                        params.bucketName, 
                        params.objectName, 
                        ctx.params
                            .pipe(gzip)
                            .pipe(cipheriv)
                            .pipe(appendInitVect), 
                        params.size, 
                        params.metaData);
                } catch (err) {
                    this.logger.debug("Upload of object failed", { bucketName: params.bucketName, objectName: params.objectName, err: err });
                    throw new Error(`Upload of object ${params.objectName} failed`);
                }
                return { bucketName: params.bucketName, objectName: params.objectName };
            }
        },

        /**
         * download an object as a stream
         * 
         * @actions
         * @param {string} objectName - name of the object.
         * 
         * @returns {ReadableStream} Decoded payload 
         */
        getObject: {
            params: {
                objectName: { type: "string" },
            },
            async handler(ctx) {
                let owner = this.getOwnerId({ ctx: ctx, abort: true });
                
                let encrypted, iv, oekId, oek, decipher;
                
                let bucketName = owner;
                let ressource = {
                    bucketName: bucketName,
                    objectName: ctx.params.objectName
                };
                if (!await this.isAuthorized({ ctx: ctx, ressource: ressource, action: "getObject" })) throw new Error("not authorized");
                
                let self = this;
                
                function getHeader() {
                    let header;
        
                    return new Promise((resolve, reject) => {
                        self.client.getPartialObject(bucketName, ctx.params.objectName, 0, 116, (err, dataStream) => {
                            if (err) {
                                self.logger.warn("Failed to retrieve header of file", { err: err });
                                return reject(err);
                            }
                            dataStream.on("data", function(chunk) {
                                header ? header += chunk : header = chunk;
                            });
                            dataStream.on("close", function() {
                                return resolve(header);
                            });
                        }); 
                    });
                }
                let header = await getHeader();
                iv = header.slice(0,16);
                oekId = header.slice(16,100).toString();

                // get owner's encryption key
                try {
                    oek = await this.getKey({ ctx: ctx, id: oekId });
                } catch (err) {
                    throw new Error("failed to retrieve owner encryption key");
                }
                
                try {
                    let secret = crypto.createHash("SHA256")    // secret must be 256 bit long
                        .update(oek.key)
                        .digest();
                    decipher = crypto.createDecipheriv("aes-256-cbc", secret, iv);
                } catch (err) {
                    //
                }
                
                // create unzip stream
                let unzip = zlib.createUnzip();
                
                encrypted = await this.client.getPartialObject(bucketName, ctx.params.objectName, 116);
                return encrypted
                    .pipe(decipher)
                    .pipe(unzip);

            }
        },

        /**
         * remove object from bucket
         * 
         * @actions
         * @param {string} objectName - Name of the object
         *
         * @meta
         * @param {string} acl.owner.id - Id of object owner
         * 
         * @returns {object} bucketName, objectName
         */
        removeObject: {
            params: {
                objectName: {type: "string"}
            },			
            async handler(ctx) {
                let owner = this.getOwnerId({ ctx: ctx, abort: true });

                let bucketName = owner;
                let objectName = ctx.params.objectName;

                let ressource = {
                    bucketName: bucketName,
                    objectName: objectName
                };
                if (!await this.isAuthorized({ ctx: ctx, ressource: ressource, action: "removeObject" })) throw new Error("not authorized");
                
                try {
                    await this.client.removeObject(bucketName, objectName);
                } catch (err) {
                    throw new Error(`Remove object ${objectName} failed`);
                }
                return { bucketName: bucketName, objectName: objectName };
            }
        },        
        
        /**
         * remove multiple object from bucket
         * 
         * @actions
         * @param {array} objectsList - Array of object names
         *
         * @meta
         * @param {string} acl.owner.id - Id of object owner
         * 
         * @returns {object} bucketName, objectName
         */
        removeObjects: {
            params: {
                objectsList: { type: "array", items: "string" }
            },			
            async handler(ctx) {
                let owner = this.getOwnerId({ ctx: ctx, abort: true });

                let bucketName = owner;
                for (let i=0; i<ctx.params.objectsList.length; i++) {
                    let ressource = {
                        bucketName: bucketName,
                        objectName: ctx.params.objectsList[i]
                    };
                    if (!await this.isAuthorized({ ctx: ctx, ressource: ressource, action: "removeObject" })) throw new Error("not authorized");
                }
                
                try {
                    await this.client.removeObjects(bucketName, ctx.params.objectsList);
                } catch (err) {
                    throw new Error("Failed to remove Objects");
                }
                return true;
            }
        },        
        
        /**
         * list all objects in the bucket in a readable stream
         * 
         * @actions
         * @param {string} prefix - the prefix of the objects that should be listed (default '')
         * @param {booelan} recursive - true indicates recursive style listing and false indicates directory style listing delimited by '/'
         * @param {string} startAfter - specifies the object name to start after when listing objects in a bucket. (optional, default '')
         * 
         * @returns {ReadableStream} objects 
         */
        listObjects: {
            params: {
                prefix: { type: "string", optional: true },
                recursive: { type: "boolean", optional: true },
                startAfter: { type: "string", optional: true }
            },			
            async handler(ctx) {
                let owner = this.getOwnerId({ ctx: ctx, abort: true });

                let bucketName = owner;
                let ressource = {
                    bucketName: bucketName
                };
                if (!await this.isAuthorized({ ctx: ctx, ressource: ressource, action: "listObjects" })) throw new Error("not authorized");
                
                try {
                    return this.client.listObjectsV2(bucketName, ctx.params.prefix, ctx.params.recursive, ctx.params.startAfter);
                } catch (err) {
                    throw new Error("Failed to retrieve objects list");
                }
            }
        },    

        /**
         * list all objects in the bucket in an array
         * 
         * @actions
         * @param {string} prefix - the prefix of the objects that should be listed (default '')
         * @param {booelan} recursive - true indicates recursive style listing and false indicates directory style listing delimited by '/'
         * @param {string} startAfter - specifies the object name to start after when listing objects in a bucket. (optional, default '')
         * 
         * @returns {ReadableStream} objects 
         */
        listObjectsArray: {
            params: {
                prefix: { type: "string", optional: true },
                recursive: { type: "boolean", optional: true },
                startAfter: { type: "string", optional: true }
            },			
            async handler(ctx) {
                let owner = this.getOwnerId({ ctx: ctx, abort: true });

                let bucketName = owner;
                let ressource = {
                    bucketName: bucketName
                };
                if (!await this.isAuthorized({ ctx: ctx, ressource: ressource, action: "listObjects" })) throw new Error("not authorized");
                
                return new Promise((resolve, reject) => {
                    try {
                        let stream = this.client.listObjectsV2(bucketName, ctx.params.prefix, ctx.params.recursive, ctx.params.startAfter);
                        let objects = [];
                        stream.on("data", obj => objects.push(obj));
                        stream.on("end", () => resolve(objects));
                        stream.on("error", reject);
                    } catch (err) {
                        reject(new Error("Failed to retrieve objects list"));
                    }
                });
            }
        },    
        
        /**
         * get meta data of object
         * 
         * @actions
         * @param {string} objectName - Name of the object
         * 
         * @returns {object} stat 
         */
        statObject: {
            params: {
                objectName: {type: "string"}
            },			
            async handler(ctx) {
                let owner = this.getOwnerId({ ctx: ctx, abort: true });

                let bucketName = owner;
                let objectName = ctx.params.objectName;

                let ressource = {
                    bucketName: bucketName,
                    objectName: ctx.params.objectName
                };
                if (!await this.isAuthorized({ ctx: ctx, ressource: ressource, action: "statObject" })) throw new Error("not authorized");
                
                try {
                    return this.client.statObject(bucketName, objectName);
                } catch (err) {
                    throw new Error(`Remove object ${objectName} failed`);
                }
            }
        },        
        
        
        /**
         * get all buckets
         * 
         * @actions
         * 
         * @returns {array} bucket 
         */
        listBuckets: {
            async handler(ctx) {
                let owner = this.getOwnerId({ ctx: ctx, abort: true });
                if (owner !== this.adminGroup) throw new Error("access not authorized");
                
                try {
                    return this.client.listBuckets().then(buckets => buckets ?  buckets : []);
                } catch (err) {
                    this.logger.warn("Failed to retrieve bucket list", { err: err });
                    throw new Error("Failed to retrieve bucket list");
                }
            }
        }

    },

    /**
     * Events
     */
    events: {},

    /**
     * Methods
     */
    methods: {
        
        async getKey ({ ctx = null, id = null } = {}) {
            
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
                this.logger.error("Failed to receive key from key service", { id: id, meta: ctx.meta });
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
        
        // set keys service
        this.keys = {
            service: _.get(this.settings, "keysService", "keys" )
        };
        
        // default region 
        this.region = _.get(this.settings,"minio.region","eu-central-1");
        
        // minio client
        this.client = new Minio.Client({
            endPoint: _.get(this.settings,"minio.endPoint","play.minio.io"),
            port: Number(_.get(this.settings,"minio.port",9000)),
            useSSL: _.get(this.settings,"minio.useSSL",true),
            accessKey: process.env.MINIO_ACCESS_KEY || "Q3AM3UQ867SPQQA43P2F",
            secretKey: process.env.MINIO_SECRET_KEY || "zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG"
        });
      
        this.adminGroup = _.get(this.settings, "adminGroup", "no admin group set");
    },

    /**
     * Service started lifecycle event handler
     */
    async started() {},

    /**
     * Service stopped lifecycle event handler
     */
    async stopped() {}
    
};