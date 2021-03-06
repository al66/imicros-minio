"use strict";

const { ServiceBroker } = require("moleculer");
const { Minio } = require("../index");
const fs = require("fs");
const { v4: uuid } = require("uuid");

const timestamp = Date.now();

// mock keys service
const Keys = {
    name: "keys",
    actions: {
        getOek: {
            params: {
                service: { type: "string" },
                id: { type: "string", optional: true }
            },
            handler(ctx) {
                ctx.broker.logger.info("getOek", { params: ctx.params });
                if (!ctx.params || !ctx.params.service) throw new Error("Missing service name");
                if ( ctx.params.id == "prev" ) {
                    return {
                        id: this.prev,
                        key: "myPreviousSecret"
                    };    
                }
                return {
                    id: this.current,
                    key: "mySecret"
                };
            }
        }
    },
    created() {
        this.prev = uuid();
        this.current = uuid();
        this.broker.logger.info("keys", { current: this.current, previous: this.prev });
    } 
};

const middleware = {
    // wrap local action - call acl 
    localAction(next, action) {
        return async function(ctx) {
            ctx.broker.logger.info("call wrapped action", { action: action.name });
            return next(ctx);
        };
    },
    
    async started(broker) {
        broker.logger.info("Middelware - broker started");
    }
};

describe("Test store service", () => {

    let broker, service, keyService, adminGroup;
    beforeAll(() => {
        adminGroup = uuid();
    });
    
    afterAll(async () => {
    });
    
    describe("Test create service", () => {

        it("it should start the broker", async () => {
            broker = new ServiceBroker({
                middlewares: [middleware],
                logger: console,
                logLevel: "info" //"debug"
            });
            keyService = await broker.createService(Keys);
            service = await broker.createService(Minio, Object.assign({ 
                name: "minio", 
                settings: { 
                    minio: {
                        endPoint: process.env.MINIO_ENDPOINT || "play.minio.io",
                        port: process.env.MINIO_PORT || "9000",
                        useSSL: false
                    },
                    adminGroup: adminGroup
                },
                dependencies: ["keys"]
            }));
            await broker.start();
            expect(service).toBeDefined();
            expect(keyService).toBeDefined();
        });

    });
    
    describe("Test makeBucket", () => {

        let opts;
        
        beforeEach(() => {
            opts = { 
                meta: { 
                    ownerId: `g1-${timestamp}`,
                    acl: {
                        accessToken: "this is the access token",
                        ownerId: `g1-${timestamp}`,
                        unrestricted: true
                    }, 
                    user: { 
                        id: `1-${timestamp}` , 
                        email: `1-${timestamp}@host.com` } 
                } 
            };
        });
        
        it("it should create a bucket for 1. owner", () => {
            let params = {};
            return broker.call("minio.makeBucket", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.bucketName).toBeDefined();
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });
        
        it("it should create a bucket for 2. owner", () => {
            opts.meta.ownerId = `g2-${timestamp}`;
            opts.meta.acl.ownerId = `g2-${timestamp}`;
            let params = {};
            return broker.call("minio.makeBucket", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.bucketName).toBeDefined();
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });
                
    });

    describe("Test object functions", () => {

        let opts;
        
        beforeEach(() => {
            opts = { 
                meta: { 
                    ownerId: `g1-${timestamp}`,
                    acl: {
                        accessToken: "this is the access token",
                        ownerId: `g1-${timestamp}`,
                        unrestricted: true
                    }, 
                    user: { 
                        id: `1-${timestamp}` , 
                        email: `1-${timestamp}@host.com` }
                } 
            };
        });
        
        
        it("it should put an object", () => {
            let fstream = fs.createReadStream("assets/imicros.png");
            opts.meta.store = {
                objectName: "imicros.png"      
            };
            return broker.call("minio.putObject", fstream, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.objectName).toBeDefined();
                expect(res.objectName).toEqual("imicros.png");
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });
        
        /*
        it("it should put an large object (compressed)", () => {
            jest.setTimeout(50000);
            let fstream = fs.createReadStream("assets/big.txt");
            opts.meta.store = {
                objectName: "big.txt"      
            };
            return broker.call("minio.putObject", fstream, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.objectName).toBeDefined();
                expect(res.objectName).toEqual("big.txt");
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });
        
        it("it should get an large object (compressed)", async () => {
            jest.setTimeout(50000);
            let fstream = fs.createWriteStream("assets/big_decrypted.txt");
            let params = {
                objectName: "big.txt"      
            };
            function receive(stream) {
                return new Promise(resolve => {
                    stream.pipe(fstream);
                    fstream.on("close", () => {
                        resolve();
                    });
                });
            } 
            
            let stream = await broker.call("minio.getObject", params, opts);
            await receive(stream);

        });
        */
        
        it("it should put 5 additional objects", async () => {
            let fstream = fs.createReadStream("assets/imicros.png");
            for (let i=0; i<5; i++) {
                opts.meta.store = {
                    objectName: "imicros_"+i+".png"      
                };
                await broker.call("minio.putObject", fstream, opts).then(res => {
                    expect(res).toBeDefined();
                    expect(res.objectName).toBeDefined();
                    expect(res.objectName).toEqual("imicros_"+i+".png" );
                    expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
                });
            }
            
        });

        it("it should get an object", async () => {
            let fstream = fs.createWriteStream("assets/imicros.restored.png");
            let params = {
                objectName: "imicros.png"      
            };
            function receive(stream) {
                return new Promise(resolve => {
                    stream.pipe(fstream);
                    fstream.on("close", () => {
                        resolve();
                    });
                });
            } 
            
            let stream = await broker.call("minio.getObject", params, opts);
            await receive(stream);
        });

        it("it should get meta data of an object", () => {
            let params = {
                objectName: "imicros.png"      
            };
            return broker.call("minio.statObject", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.size).toBeDefined();
                expect(res.lastModified).toBeDefined();
                expect(res.etag).toBeDefined();
                expect(res.metaData).toBeDefined();
                expect(res.metaData.iv).toBeDefined();
                expect(res.metaData.oek).toBeDefined();
            });
            
        });

        it("it should list the objects in the bucket as an array", async () => {
            let params = {
            };
            return broker.call("minio.listObjectsArray", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: "imicros.png" })]));
                expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: "imicros_1.png" })]));
                expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: "imicros_4.png" })]));
            });
        });
        
        it("it should list the objects in the bucket as an readable stream", async () => {
            let params = {
            };
            function receive(stream) {
                return new Promise((resolve, reject) => {
                    let objects = [];
                    stream.on("data", obj => objects.push(obj));
                    stream.on("end", () => resolve(objects));
                    stream.on("error", reject);
                });
            } 
            let stream = await broker.call("minio.listObjects", params, opts);
            let res = await receive(stream);
            expect(res).toBeDefined();
            expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: "imicros.png" })]));
            expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: "imicros_1.png" })]));
            expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: "imicros_4.png" })]));
        });
        
        it("it should remove an object", () => {
            let params = {
                objectName: "imicros.png"      
            };
            return broker.call("minio.removeObject", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.objectName).toBeDefined();
                expect(res.objectName).toEqual("imicros.png");
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });

        it("it should remove a list of objects", () => {
            let params = {
                objectsList: []      
            };
            for (let i=0; i<5; i++) {
                params.objectsList.push("imicros_"+i+".png");
            }
            return broker.call("minio.removeObjects", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(true);
            });
            
        });
        
        
    }); 

    describe("Test admin", () => {
    
        it("it should list all buckets", async () => {
            let opts = { 
                meta: { 
                    ownerId: adminGroup,
                    acl: { ownerId: adminGroup }
                } 
            };
            let params = {
            };
            let res = await broker.call("minio.listBuckets", params, opts);
            expect(res).toBeDefined();
            expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: `g1-${timestamp}` })]));
            expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: `g2-${timestamp}` })]));
        });
        
    });
        
    describe("Test removeBucket", () => {

        let opts;
        
        beforeEach(() => {
            opts = { 
                meta: { 
                    ownerId: `g1-${timestamp}`,
                    acl: {
                        accessToken: "this is the access token",
                        ownerId: `g1-${timestamp}`,
                        unrestricted: true
                    }, 
                    user: { 
                        id: `1-${timestamp}` , 
                        email: `1-${timestamp}@host.com` } 
                } 
            };
        });
        
        it("it should remove bucket for 1. owner", () => {
            let params = {};
            return broker.call("minio.removeBucket", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.bucketName).toBeDefined();
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });
        
        it("it should remove bucket for 2. owner", () => {
            opts.meta.ownerId = `g2-${timestamp}`;
            opts.meta.acl.ownerId = `g2-${timestamp}`;
            let params = {};
            return broker.call("minio.removeBucket", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.bucketName).toBeDefined();
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });
                
    });

 
    describe("Test stop broker", () => {
        it("should stop the broker", async () => {
            expect.assertions(1);
            await broker.stop();
            expect(broker).toBeDefined();
        });
    });    
    
});