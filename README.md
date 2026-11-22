<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>
<p align="center">
<a href="https://www.npmjs.com/package/homebridge-thermoworks"><img title="npm version" src="https://badgen.net/npm/v/homebridge-thermoworks?label=stable"></a>
<a href="https://www.npmjs.com/package/homebridge-thermoworks"><img title="npm downloads" src="https://badgen.net/npm/dt/homebridge-thermoworks"></a>
<a href="https://github.com/gorhack/thermoworks/actions/workflows/build.yml"><img title="Node Build" src="https://github.com/gorhack/thermoworks/actions/workflows/build.yml/badge.svg"></a>
</p>

# ThermoWorks Homebridge Plugin

### This is an unofficial plugin to use your [ThermoWorks](https://thermoworks.com/) Node sensor with [Homebridge](https://homebridge.io/).

You will need your API key, provided in your [account](https://cloud.thermoworks.com/account) settings --> Integrations. This plugin relies on the API provided by ThermoWorks and is dependent on its uptime to retrieve your latest sensors and readings. 

Each device is represented by one accessory, with a temperature or humidity service for each supported channel.
The plugin checks the device list every five minutes; readings are only as current as the device's last transmission.

### Development Roadmap:
- [x] Discover all sensors and probes
- [x] Temperature and humidity sensors
- [ ] Handle API errors gracefully
- [ ] Homebridge [verified](https://github.com/homebridge/verified)
