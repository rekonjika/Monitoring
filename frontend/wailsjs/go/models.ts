export namespace main {
	
	export class Config {
	    mqtt_broker: string;
	    mqtt_port: number;
	    stations_count: number;
	    sound_file_path: string;
	    node_names: Record<string, string>;
	    telegram_enabled: boolean;
	    telegram_bot_token: string;
	    telegram_chat_id: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mqtt_broker = source["mqtt_broker"];
	        this.mqtt_port = source["mqtt_port"];
	        this.stations_count = source["stations_count"];
	        this.sound_file_path = source["sound_file_path"];
	        this.node_names = source["node_names"];
	        this.telegram_enabled = source["telegram_enabled"];
	        this.telegram_bot_token = source["telegram_bot_token"];
	        this.telegram_chat_id = source["telegram_chat_id"];
	    }
	}

}

