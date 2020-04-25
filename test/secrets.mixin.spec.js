"use strict";

const { ServiceBroker } = require("moleculer");
const { SecretsMixin } = require("../index");
const { v4: uuid } = require("uuid");
const util = require("util");

const timestamp = Date.now();

// mock keys service
const Keys = {
    name: "keys",
    actions: {
        getOek: {
            handler(ctx) {
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
    } 
};

const Test = {
    actions: {
        encryptObject: {
            params: {
                object: "object"
            },
            async handler(ctx) {
                return this.encrypt({ ctx: ctx, object: ctx.params.object });
            }
        },
        decryptObject: {
            params: {
                object: "object"
            },
            async handler(ctx) {
                return this.decrypt({ ctx: ctx, object: ctx.params.object });
            }
        }
    }
};


describe("Test mixin service", () => {

    let broker, service, keyService;
    beforeAll(() => {
    });
    
    afterAll(() => {
    });
    
    describe("Test create service", () => {

        it("it should start the broker", async () => {
            broker = new ServiceBroker({
                logger: console,
                logLevel: "info" //"debug"
            });
            keyService = await broker.createService(Keys);
            service = await broker.createService(Test, Object.assign({ 
                name: "test", 
                mixins: [SecretsMixin({ service: "keys" })],
                dependencies: ["keys"]
            }));
            await broker.start();
            expect(service).toBeDefined();
            expect(keyService).toBeDefined();
        });

    });

    describe("Test encrypt / decrypt objects", () => {

        let opts, object;
        
        beforeEach(() => {
            opts = { 
                meta: { 
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
        
        it("it should encrypt object", () => {
            let params = {
                object: { connection: { account: { name: "any value", user: "my user", password: { _encrypt: { value: "my sycret" } } } } }
            };
            return broker.call("test.encryptObject", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.connection.account.name).toEqual("any value");
                expect(res.connection.account.password._encrypted).toBeDefined();
                expect(res.connection.account.password._encrypted.iv).toBeDefined();
                expect(res.connection.account.password._encrypted.oekId).toBeDefined();
                expect(res.connection.account.password._encrypted.value).toBeDefined();
                expect(res.connection.account.password._encrypted.value).not.toEqual("my sycret");
                console.log(util.inspect(res, {showHidden: false, depth: null, colors: true}));
                object = res;
            });
            
        });
        
        it("it should decrypt object", () => {
            let params = {
                object: object
            };
            return broker.call("test.decryptObject", params, opts).then(res => {
                expect(res).toBeDefined();
                console.log(util.inspect(res, {showHidden: false, depth: null, colors: true}));
                expect(res.connection.account.name).toEqual("any value");
                expect(res.connection.account.password).toEqual("my sycret");
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