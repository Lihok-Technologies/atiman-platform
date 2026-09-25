#!/usr/bin/env python3
"""
ODM legacy equipment taxonomy DESIGN generator (ODM-CMMS era).

Emits the ODM-authored equipment taxonomy design dataset. The structure is
INFORMED BY ISO 14224 concepts, but this dataset is NOT an ISO 14224 extract:
it contains no ISO-defined equipment-class codes and carries no ISO
conformance claim. See
docs/architecture/ATM-001-M5R2-Legacy-Taxonomy-Provenance.md.

Output paths are resolved relative to THIS script, so the result does not
depend on the caller's working directory. The generator writes:
  - the authoritative design artifact, beside this script; and
  - the seed copy consumed by the import tooling.
"""

import json
import os

# Equipment Categories
equipment_categories = [
    {"id": "ECAT-001", "code": "ROTATING", "name": "Rotating Equipment", "description": "Equipment with rotating components including pumps, compressors, turbines, fans, and mixers", "is_active": True},
    {"id": "ECAT-002", "code": "ELECTRICAL", "name": "Electrical Equipment", "description": "Electrical machinery and power distribution equipment including motors, generators, transformers, and switchgear", "is_active": True},
    {"id": "ECAT-003", "code": "INSTRUMENT", "name": "Instrumentation and Control", "description": "Process measurement and control instruments including pressure, flow, level, temperature devices, and analyzers", "is_active": True},
    {"id": "ECAT-004", "code": "VALVE", "name": "Valves", "description": "Flow control devices including isolation, control, relief, and actuated valves", "is_active": True},
    {"id": "ECAT-005", "code": "STATIC", "name": "Static Equipment", "description": "Non-rotating process equipment including vessels, tanks, heat exchangers, and separators", "is_active": True},
    {"id": "ECAT-006", "code": "PIPING", "name": "Piping Systems", "description": "Fluid transport systems including pipelines, piping assemblies, fittings, and strainers", "is_active": True},
    {"id": "ECAT-007", "code": "HVAC", "name": "HVAC Equipment", "description": "Heating, ventilation, and air conditioning equipment including chillers, cooling towers, and air handling units", "is_active": True},
    {"id": "ECAT-008", "code": "STRUCTURE", "name": "Structures", "description": "Support and access structures including equipment supports, platforms, and ladders", "is_active": True},
    {"id": "ECAT-009", "code": "SAFETY", "name": "Safety Systems", "description": "Safety and protection equipment including fire protection, gas detection, and emergency wash stations", "is_active": True},
    {"id": "ECAT-010", "code": "UTILITY", "name": "Utility Equipment", "description": "Utility support equipment including boilers, water treatment units, and air dryers", "is_active": True}
]

# Equipment Classes (42 classes)
equipment_classes = [
    {"id": "ECLS-001", "equipment_category_id": "ECAT-001", "code": "PUMP", "name": "Pump", "description": "Equipment for fluid movement and pressure increase", "is_active": True},
    {"id": "ECLS-002", "equipment_category_id": "ECAT-001", "code": "COMPRESSOR", "name": "Compressor", "description": "Equipment for gas compression and pressure increase", "is_active": True},
    {"id": "ECLS-003", "equipment_category_id": "ECAT-001", "code": "TURBINE", "name": "Turbine", "description": "Equipment for energy conversion from fluid flow to rotational energy", "is_active": True},
    {"id": "ECLS-004", "equipment_category_id": "ECAT-001", "code": "FAN_BLOWER", "name": "Fan and Blower", "description": "Equipment for air and gas movement at lower pressures", "is_active": True},
    {"id": "ECLS-005", "equipment_category_id": "ECAT-001", "code": "TRANSMISSION", "name": "Transmission Equipment", "description": "Equipment for power transmission and speed modification", "is_active": True},
    {"id": "ECLS-006", "equipment_category_id": "ECAT-001", "code": "MIXING", "name": "Mixing Equipment", "description": "Equipment for blending, agitating, and mixing materials", "is_active": True},
    {"id": "ECLS-007", "equipment_category_id": "ECAT-002", "code": "MOTOR", "name": "Motor", "description": "Equipment for electrical to mechanical energy conversion", "is_active": True},
    {"id": "ECLS-008", "equipment_category_id": "ECAT-002", "code": "GENERATOR", "name": "Generator", "description": "Equipment for mechanical to electrical energy conversion", "is_active": True},
    {"id": "ECLS-009", "equipment_category_id": "ECAT-002", "code": "TRANSFORMER", "name": "Transformer", "description": "Equipment for voltage transformation and power distribution", "is_active": True},
    {"id": "ECLS-010", "equipment_category_id": "ECAT-002", "code": "SWITCHGEAR", "name": "Switchgear", "description": "Equipment for electrical power switching and protection", "is_active": True},
    {"id": "ECLS-011", "equipment_category_id": "ECAT-002", "code": "POWER_BACKUP", "name": "Power Backup Equipment", "description": "Equipment for uninterrupted and backup power supply", "is_active": True},
    {"id": "ECLS-012", "equipment_category_id": "ECAT-002", "code": "POWER_CONVERSION", "name": "Power Conversion Equipment", "description": "Equipment for electrical power conditioning and control", "is_active": True},
    {"id": "ECLS-013", "equipment_category_id": "ECAT-003", "code": "PRESSURE_INSTRUMENT", "name": "Pressure Instrument", "description": "Equipment for pressure measurement and monitoring", "is_active": True},
    {"id": "ECLS-014", "equipment_category_id": "ECAT-003", "code": "FLOW_INSTRUMENT", "name": "Flow Instrument", "description": "Equipment for flow rate measurement and monitoring", "is_active": True},
    {"id": "ECLS-015", "equipment_category_id": "ECAT-003", "code": "LEVEL_INSTRUMENT", "name": "Level Instrument", "description": "Equipment for level measurement and monitoring", "is_active": True},
    {"id": "ECLS-016", "equipment_category_id": "ECAT-003", "code": "TEMPERATURE_INSTRUMENT", "name": "Temperature Instrument", "description": "Equipment for temperature measurement and monitoring", "is_active": True},
    {"id": "ECLS-017", "equipment_category_id": "ECAT-003", "code": "ANALYZER", "name": "Analyzer", "description": "Equipment for chemical and physical property analysis", "is_active": True},
    {"id": "ECLS-018", "equipment_category_id": "ECAT-004", "code": "ISOLATION_VALVE", "name": "Isolation Valve", "description": "Valves for flow isolation and on-off control", "is_active": True},
    {"id": "ECLS-019", "equipment_category_id": "ECAT-004", "code": "CONTROL_VALVE", "name": "Control Valve", "description": "Valves for flow modulation and process control", "is_active": True},
    {"id": "ECLS-020", "equipment_category_id": "ECAT-004", "code": "RELIEF_VALVE", "name": "Relief Valve", "description": "Valves for overpressure protection", "is_active": True},
    {"id": "ECLS-021", "equipment_category_id": "ECAT-004", "code": "ACTUATED_VALVE", "name": "Actuated Valve", "description": "Valves with powered actuation mechanisms", "is_active": True},
    {"id": "ECLS-022", "equipment_category_id": "ECAT-005", "code": "VESSEL", "name": "Vessel", "description": "Pressurized containers for process operations", "is_active": True},
    {"id": "ECLS-023", "equipment_category_id": "ECAT-005", "code": "TANK", "name": "Tank", "description": "Storage containers for liquids and gases", "is_active": True},
    {"id": "ECLS-024", "equipment_category_id": "ECAT-005", "code": "HEAT_EXCHANGER", "name": "Heat Exchanger", "description": "Equipment for heat transfer between fluids", "is_active": True},
    {"id": "ECLS-025", "equipment_category_id": "ECAT-005", "code": "FILTRATION", "name": "Filtration Equipment", "description": "Equipment for solid removal from fluids", "is_active": True},
    {"id": "ECLS-026", "equipment_category_id": "ECAT-005", "code": "SEPARATOR", "name": "Separator", "description": "Equipment for phase separation", "is_active": True},
    {"id": "ECLS-027", "equipment_category_id": "ECAT-006", "code": "PIPELINE", "name": "Pipeline", "description": "Long-distance fluid transport piping", "is_active": True},
    {"id": "ECLS-028", "equipment_category_id": "ECAT-006", "code": "PIPING_ASSEMBLY", "name": "Piping Assembly", "description": "Interconnected piping systems and headers", "is_active": True},
    {"id": "ECLS-029", "equipment_category_id": "ECAT-006", "code": "PIPE_FITTING", "name": "Pipe Fitting", "description": "Components for connecting and directing piping", "is_active": True},
    {"id": "ECLS-030", "equipment_category_id": "ECAT-006", "code": "STRAINER", "name": "Strainer", "description": "Devices for debris removal from fluid streams", "is_active": True},
    {"id": "ECLS-031", "equipment_category_id": "ECAT-007", "code": "CHILLER", "name": "Chiller", "description": "Equipment for cooling fluid generation", "is_active": True},
    {"id": "ECLS-032", "equipment_category_id": "ECAT-007", "code": "COOLING_TOWER", "name": "Cooling Tower", "description": "Equipment for heat rejection to atmosphere", "is_active": True},
    {"id": "ECLS-033", "equipment_category_id": "ECAT-007", "code": "AIR_HANDLING_UNIT", "name": "Air Handling Unit", "description": "Equipment for air circulation and conditioning", "is_active": True},
    {"id": "ECLS-034", "equipment_category_id": "ECAT-007", "code": "FAN_COIL_UNIT", "name": "Fan Coil Unit", "description": "Terminal units for local air conditioning", "is_active": True},
    {"id": "ECLS-035", "equipment_category_id": "ECAT-008", "code": "SUPPORT_STRUCTURE", "name": "Support Structure", "description": "Structures for equipment mounting and support", "is_active": True},
    {"id": "ECLS-036", "equipment_category_id": "ECAT-008", "code": "ACCESS_STRUCTURE", "name": "Access Structure", "description": "Structures for personnel access to equipment", "is_active": True},
    {"id": "ECLS-037", "equipment_category_id": "ECAT-009", "code": "FIRE_PROTECTION", "name": "Fire Protection Equipment", "description": "Equipment for fire detection and suppression", "is_active": True},
    {"id": "ECLS-038", "equipment_category_id": "ECAT-009", "code": "GAS_DETECTION", "name": "Gas Detection Equipment", "description": "Equipment for hazardous gas detection and alarm", "is_active": True},
    {"id": "ECLS-039", "equipment_category_id": "ECAT-009", "code": "EMERGENCY_WASH", "name": "Emergency Wash Equipment", "description": "Equipment for emergency personnel decontamination", "is_active": True},
    {"id": "ECLS-040", "equipment_category_id": "ECAT-010", "code": "BOILER", "name": "Boiler", "description": "Equipment for steam and hot water generation", "is_active": True},
    {"id": "ECLS-041", "equipment_category_id": "ECAT-010", "code": "WATER_TREATMENT", "name": "Water Treatment Unit", "description": "Equipment for water quality conditioning", "is_active": True},
    {"id": "ECLS-042", "equipment_category_id": "ECAT-010", "code": "AIR_DRYER", "name": "Air Dryer", "description": "Equipment for compressed air moisture removal", "is_active": True}
]

# Equipment Types (60 types)
equipment_types = [
    {"id": "ETYPE-001", "equipment_class_id": "ECLS-001", "code": "CENTRIFUGAL_PUMP", "name": "Centrifugal Pump", "description": "Pump using centrifugal force for fluid movement", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-002", "equipment_class_id": "ECLS-001", "code": "POSITIVE_DISPLACEMENT_PUMP", "name": "Positive Displacement Pump", "description": "Pump using mechanical displacement for fluid movement", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-003", "equipment_class_id": "ECLS-002", "code": "RECIPROCATING_COMPRESSOR", "name": "Reciprocating Compressor", "description": "Compressor using reciprocating piston motion", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-004", "equipment_class_id": "ECLS-002", "code": "ROTARY_SCREW_COMPRESSOR", "name": "Rotary Screw Compressor", "description": "Compressor using intermeshing rotary screws", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-005", "equipment_class_id": "ECLS-003", "code": "STEAM_TURBINE", "name": "Steam Turbine", "description": "Turbine driven by steam expansion", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-006", "equipment_class_id": "ECLS-003", "code": "GAS_TURBINE", "name": "Gas Turbine", "description": "Turbine driven by combustion gases", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-007", "equipment_class_id": "ECLS-004", "code": "CENTRIFUGAL_FAN", "name": "Centrifugal Fan", "description": "Fan using centrifugal blade arrangement", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-008", "equipment_class_id": "ECLS-004", "code": "AXIAL_FAN", "name": "Axial Fan", "description": "Fan using axial blade arrangement", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-009", "equipment_class_id": "ECLS-004", "code": "CENTRIFUGAL_BLOWER", "name": "Centrifugal Blower", "description": "High-pressure centrifugal air mover", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-010", "equipment_class_id": "ECLS-005", "code": "GEARBOX", "name": "Gearbox", "description": "Speed and torque modification device using gears", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-011", "equipment_class_id": "ECLS-006", "code": "MIXER", "name": "Mixer", "description": "Equipment for blending materials", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-012", "equipment_class_id": "ECLS-006", "code": "AGITATOR", "name": "Agitator", "description": "Equipment for liquid agitation and mixing", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-013", "equipment_class_id": "ECLS-007", "code": "ELECTRIC_MOTOR", "name": "Electric Motor", "description": "Rotating machine converting electrical to mechanical energy", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-014", "equipment_class_id": "ECLS-008", "code": "AC_GENERATOR", "name": "AC Generator", "description": "Rotating machine converting mechanical to alternating current electrical energy", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-015", "equipment_class_id": "ECLS-009", "code": "POWER_TRANSFORMER", "name": "Power Transformer", "description": "High-capacity transformer for transmission and distribution", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-016", "equipment_class_id": "ECLS-009", "code": "DISTRIBUTION_TRANSFORMER", "name": "Distribution Transformer", "description": "Lower-capacity transformer for local power distribution", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-017", "equipment_class_id": "ECLS-010", "code": "SWITCHGEAR_PANEL", "name": "Switchgear Panel", "description": "Enclosed assembly of switching and protection devices", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-018", "equipment_class_id": "ECLS-011", "code": "UPS_SYSTEM", "name": "UPS System", "description": "Uninterruptible power supply system", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-019", "equipment_class_id": "ECLS-011", "code": "BATTERY_BANK", "name": "Battery Bank", "description": "Assembly of batteries for energy storage", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-020", "equipment_class_id": "ECLS-012", "code": "VARIABLE_FREQUENCY_DRIVE", "name": "Variable Frequency Drive", "description": "Equipment for motor speed control through frequency variation", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-021", "equipment_class_id": "ECLS-013", "code": "PRESSURE_GAUGE", "name": "Pressure Gauge", "description": "Local pressure indicating instrument", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-022", "equipment_class_id": "ECLS-013", "code": "PRESSURE_TRANSMITTER", "name": "Pressure Transmitter", "description": "Pressure sensing device with signal transmission", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-023", "equipment_class_id": "ECLS-014", "code": "FLOWMETER", "name": "Flowmeter", "description": "Device for flow rate measurement", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-024", "equipment_class_id": "ECLS-015", "code": "LEVEL_TRANSMITTER", "name": "Level Transmitter", "description": "Level sensing device with signal transmission", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-025", "equipment_class_id": "ECLS-015", "code": "LEVEL_SWITCH", "name": "Level Switch", "description": "Level detection device with discrete output", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-026", "equipment_class_id": "ECLS-016", "code": "TEMPERATURE_TRANSMITTER", "name": "Temperature Transmitter", "description": "Temperature sensing device with signal transmission", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-027", "equipment_class_id": "ECLS-016", "code": "TEMPERATURE_GAUGE", "name": "Temperature Gauge", "description": "Local temperature indicating instrument", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-028", "equipment_class_id": "ECLS-017", "code": "PROCESS_ANALYZER", "name": "Process Analyzer", "description": "Device for continuous process stream analysis", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-029", "equipment_class_id": "ECLS-018", "code": "GATE_VALVE", "name": "Gate Valve", "description": "Isolation valve using linear gate closure", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-030", "equipment_class_id": "ECLS-018", "code": "BALL_VALVE", "name": "Ball Valve", "description": "Isolation valve using rotating ball closure", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-031", "equipment_class_id": "ECLS-018", "code": "BUTTERFLY_VALVE", "name": "Butterfly Valve", "description": "Isolation valve using rotating disc closure", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-032", "equipment_class_id": "ECLS-019", "code": "GLOBE_CONTROL_VALVE", "name": "Globe Control Valve", "description": "Throttling valve using globe-style body", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-033", "equipment_class_id": "ECLS-020", "code": "PRESSURE_RELIEF_VALVE", "name": "Pressure Relief Valve", "description": "Automatic overpressure protection device", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-034", "equipment_class_id": "ECLS-021", "code": "MOTORIZED_VALVE", "name": "Motorized Valve", "description": "Valve with electric motor actuator", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-035", "equipment_class_id": "ECLS-021", "code": "PNEUMATIC_ACTUATED_VALVE", "name": "Pneumatic Actuated Valve", "description": "Valve with pneumatic actuator", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-036", "equipment_class_id": "ECLS-022", "code": "PRESSURE_VESSEL", "name": "Pressure Vessel", "description": "Container designed for pressure containment", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-037", "equipment_class_id": "ECLS-023", "code": "STORAGE_TANK", "name": "Storage Tank", "description": "Container for liquid or gas storage", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-038", "equipment_class_id": "ECLS-024", "code": "SHELL_TUBE_HEAT_EXCHANGER", "name": "Shell and Tube Heat Exchanger", "description": "Heat exchanger using tube bundle within shell", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-039", "equipment_class_id": "ECLS-024", "code": "PLATE_HEAT_EXCHANGER", "name": "Plate Heat Exchanger", "description": "Heat exchanger using stacked plates", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-040", "equipment_class_id": "ECLS-025", "code": "FILTER_HOUSING", "name": "Filter Housing", "description": "Vessel containing filter elements", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-041", "equipment_class_id": "ECLS-026", "code": "SEPARATOR_VESSEL", "name": "Separator Vessel", "description": "Vessel for separation of mixed phases", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-042", "equipment_class_id": "ECLS-027", "code": "PIPELINE", "name": "Pipeline", "description": "Long-distance pipe transport system", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-043", "equipment_class_id": "ECLS-028", "code": "PIPING_SYSTEM", "name": "Piping System", "description": "Interconnected piping network", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-044", "equipment_class_id": "ECLS-029", "code": "PIPE_FITTING", "name": "Pipe Fitting", "description": "Component for pipe connection and direction change", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-045", "equipment_class_id": "ECLS-030", "code": "STRAINER", "name": "Strainer", "description": "Device for debris removal from fluid streams", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-046", "equipment_class_id": "ECLS-031", "code": "CHILLER", "name": "Chiller", "description": "Refrigeration equipment for cooling fluid", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-047", "equipment_class_id": "ECLS-032", "code": "COOLING_TOWER", "name": "Cooling Tower", "description": "Heat rejection device using evaporative cooling", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-048", "equipment_class_id": "ECLS-033", "code": "AIR_HANDLING_UNIT", "name": "Air Handling Unit", "description": "Central air conditioning equipment", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-049", "equipment_class_id": "ECLS-034", "code": "FAN_COIL_UNIT", "name": "Fan Coil Unit", "description": "Local air conditioning terminal unit", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-050", "equipment_class_id": "ECLS-035", "code": "EQUIPMENT_SUPPORT", "name": "Equipment Support", "description": "Structural support for machinery and vessels", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-051", "equipment_class_id": "ECLS-036", "code": "PLATFORM", "name": "Platform", "description": "Elevated work surface for equipment access", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-052", "equipment_class_id": "ECLS-036", "code": "LADDER", "name": "Ladder", "description": "Vertical access structure", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-053", "equipment_class_id": "ECLS-037", "code": "FIRE_PUMP_SYSTEM", "name": "Fire Pump System", "description": "Pump system for fire water supply", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-054", "equipment_class_id": "ECLS-037", "code": "FIRE_SUPPRESSION_PANEL", "name": "Fire Suppression Panel", "description": "Control panel for fire suppression systems", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-055", "equipment_class_id": "ECLS-038", "code": "FIXED_GAS_DETECTOR", "name": "Fixed Gas Detector", "description": "Permanently installed gas detection device", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-056", "equipment_class_id": "ECLS-039", "code": "SAFETY_SHOWER", "name": "Safety Shower", "description": "Emergency body wash station", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-057", "equipment_class_id": "ECLS-039", "code": "EYEWASH_STATION", "name": "Eyewash Station", "description": "Emergency eye wash station", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-058", "equipment_class_id": "ECLS-040", "code": "BOILER", "name": "Boiler", "description": "Equipment for steam or hot water generation", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-059", "equipment_class_id": "ECLS-041", "code": "WATER_TREATMENT_UNIT", "name": "Water Treatment Unit", "description": "Equipment for water conditioning and purification", "template_anchor": True, "is_active": True},
    {"id": "ETYPE-060", "equipment_class_id": "ECLS-042", "code": "AIR_DRYER", "name": "Air Dryer", "description": "Equipment for compressed air moisture removal", "template_anchor": True, "is_active": True}
]

# Subunits (288 subunits for 60 equipment types)
subunits = []

# Centrifugal Pump subunits
pump_subunits = [
    ("SUBU-001", "ETYPE-001", "DRIVER_INTERFACE", "Driver Interface", "Connection between driver and driven equipment", 1),
    ("SUBU-002", "ETYPE-001", "COUPLING_ASSEMBLY", "Coupling Assembly", "Power transmission coupling between shafts", 2),
    ("SUBU-003", "ETYPE-001", "CASING_ASSEMBLY", "Casing Assembly", "Pressure-containing pump casing", 3),
    ("SUBU-004", "ETYPE-001", "ROTOR_ASSEMBLY", "Rotor Assembly", "Rotating components including impeller and shaft", 4),
    ("SUBU-005", "ETYPE-001", "BEARING_ASSEMBLY", "Bearing Assembly", "Shaft support bearings", 5),
    ("SUBU-006", "ETYPE-001", "SEALING_SYSTEM", "Sealing System", "Shaft sealing arrangement", 6),
]

# Positive Displacement Pump subunits
pd_pump_subunits = [
    ("SUBU-007", "ETYPE-002", "DRIVER_INTERFACE", "Driver Interface", "Connection between driver and driven equipment", 1),
    ("SUBU-008", "ETYPE-002", "COUPLING_ASSEMBLY", "Coupling Assembly", "Power transmission coupling between shafts", 2),
    ("SUBU-009", "ETYPE-002", "PUMP_HOUSING", "Pump Housing", "Main pump body containing pumping elements", 3),
    ("SUBU-010", "ETYPE-002", "PUMPING_ELEMENT", "Pumping Element", "Rotating or reciprocating pumping mechanism", 4),
    ("SUBU-011", "ETYPE-002", "BEARING_ASSEMBLY", "Bearing Assembly", "Shaft support bearings", 5),
    ("SUBU-012", "ETYPE-002", "SEALING_SYSTEM", "Sealing System", "Shaft sealing arrangement", 6),
]

# Reciprocating Compressor subunits
recip_comp_subunits = [
    ("SUBU-013", "ETYPE-003", "DRIVER_INTERFACE", "Driver Interface", "Connection to prime mover", 1),
    ("SUBU-014", "ETYPE-003", "FRAME_ASSEMBLY", "Frame Assembly", "Structural frame and foundation interface", 2),
    ("SUBU-015", "ETYPE-003", "CYLINDER_ASSEMBLY", "Cylinder Assembly", "Compression cylinders and heads", 3),
    ("SUBU-016", "ETYPE-003", "PISTON_ASSEMBLY", "Piston Assembly", "Pistons and connecting rods", 4),
    ("SUBU-017", "ETYPE-003", "VALVE_SYSTEM", "Valve System", "Suction and discharge valves", 5),
    ("SUBU-018", "ETYPE-003", "LUBRICATION_SYSTEM", "Lubrication System", "Oil distribution and cooling system", 6),
]

# Rotary Screw Compressor subunits
rotary_comp_subunits = [
    ("SUBU-019", "ETYPE-004", "DRIVER_INTERFACE", "Driver Interface", "Connection to prime mover", 1),
    ("SUBU-020", "ETYPE-004", "COMPRESSION_CHAMBER", "Compression Chamber", "Air-end housing and rotors", 2),
    ("SUBU-021", "ETYPE-004", "AIR_FILTER_SYSTEM", "Air Filter System", "Intake air filtration", 3),
    ("SUBU-022", "ETYPE-004", "OIL_SEPARATION_SYSTEM", "Oil Separation System", "Oil removal from compressed air", 4),
    ("SUBU-023", "ETYPE-004", "COOLING_SYSTEM", "Cooling System", "Heat exchangers and cooling fans", 5),
    ("SUBU-024", "ETYPE-004", "CONTROL_SYSTEM", "Control System", "Operation and monitoring controls", 6),
]

# Steam Turbine subunits
steam_turbine_subunits = [
    ("SUBU-025", "ETYPE-005", "TURBINE_INLET", "Turbine Inlet", "Steam inlet and control valves", 1),
    ("SUBU-026", "ETYPE-005", "CASING_ASSEMBLY", "Casing Assembly", "Pressure-containing turbine casing", 2),
    ("SUBU-027", "ETYPE-005", "ROTOR_ASSEMBLY", "Rotor Assembly", "Turbine shaft and blading", 3),
    ("SUBU-028", "ETYPE-005", "BEARING_SYSTEM", "Bearing System", "Journal and thrust bearings", 4),
    ("SUBU-029", "ETYPE-005", "GOVERNING_SYSTEM", "Governing System", "Speed and load control system", 5),
    ("SUBU-030", "ETYPE-005", "SEALING_SYSTEM", "Sealing System", "Shaft sealing arrangement", 6),
]

# Gas Turbine subunits
gas_turbine_subunits = [
    ("SUBU-031", "ETYPE-006", "AIR_INLET_SYSTEM", "Air Inlet System", "Air intake and filtration", 1),
    ("SUBU-032", "ETYPE-006", "COMPRESSOR_SECTION", "Compressor Section", "Axial or centrifugal compressor", 2),
    ("SUBU-033", "ETYPE-006", "COMBUSTION_SYSTEM", "Combustion System", "Combustors and fuel injection", 3),
    ("SUBU-034", "ETYPE-006", "TURBINE_SECTION", "Turbine Section", "Power turbine and blading", 4),
    ("SUBU-035", "ETYPE-006", "EXHAUST_SYSTEM", "Exhaust System", "Exhaust ducting and heat recovery", 5),
    ("SUBU-036", "ETYPE-006", "CONTROL_SYSTEM", "Control System", "Operation and protection systems", 6),
]

# Centrifugal Fan subunits
centrifugal_fan_subunits = [
    ("SUBU-037", "ETYPE-007", "DRIVE_ASSEMBLY", "Drive Assembly", "Motor and belt drive connection", 1),
    ("SUBU-038", "ETYPE-007", "HOUSING_ASSEMBLY", "Housing Assembly", "Fan scroll and housing", 2),
    ("SUBU-039", "ETYPE-007", "IMPELLER_ASSEMBLY", "Impeller Assembly", "Fan wheel and blades", 3),
    ("SUBU-040", "ETYPE-007", "BEARING_SYSTEM", "Bearing System", "Shaft support bearings", 4),
    ("SUBU-041", "ETYPE-007", "INLET_OUTLET", "Inlet Outlet", "Duct connection points", 5),
]

# Axial Fan subunits
axial_fan_subunits = [
    ("SUBU-042", "ETYPE-008", "DRIVE_ASSEMBLY", "Drive Assembly", "Motor and coupling connection", 1),
    ("SUBU-043", "ETYPE-008", "HOUSING_ASSEMBLY", "Housing Assembly", "Fan cylinder housing", 2),
    ("SUBU-044", "ETYPE-008", "ROTOR_ASSEMBLY", "Rotor Assembly", "Fan hub and blades", 3),
    ("SUBU-045", "ETYPE-008", "GUIDE_VANE_SYSTEM", "Guide Vane System", "Inlet guide vanes for flow control", 4),
    ("SUBU-046", "ETYPE-008", "BEARING_SYSTEM", "Bearing System", "Shaft support bearings", 5),
]

# Centrifugal Blower subunits
blower_subunits = [
    ("SUBU-047", "ETYPE-009", "DRIVE_ASSEMBLY", "Drive Assembly", "Motor and drive connection", 1),
    ("SUBU-048", "ETYPE-009", "HOUSING_ASSEMBLY", "Housing Assembly", "Blower casing and scroll", 2),
    ("SUBU-049", "ETYPE-009", "IMPELLER_ASSEMBLY", "Impeller Assembly", "Blower wheel", 3),
    ("SUBU-050", "ETYPE-009", "BEARING_SYSTEM", "Bearing System", "Shaft support bearings", 4),
    ("SUBU-051", "ETYPE-009", "SEALING_SYSTEM", "Sealing System", "Shaft seals", 5),
]

# Gearbox subunits
gearbox_subunits = [
    ("SUBU-052", "ETYPE-010", "HOUSING_ASSEMBLY", "Housing Assembly", "Gearbox casing", 1),
    ("SUBU-053", "ETYPE-010", "INPUT_SHAFT", "Input Shaft", "Power input shaft assembly", 2),
    ("SUBU-054", "ETYPE-010", "OUTPUT_SHAFT", "Output Shaft", "Power output shaft assembly", 3),
    ("SUBU-055", "ETYPE-010", "GEAR_TRAIN", "Gear Train", "Gears and pinions", 4),
    ("SUBU-056", "ETYPE-010", "BEARING_SYSTEM", "Bearing System", "Shaft support bearings", 5),
    ("SUBU-057", "ETYPE-010", "LUBRICATION_SYSTEM", "Lubrication System", "Oil circulation system", 6),
]

# Mixer subunits
mixer_subunits = [
    ("SUBU-058", "ETYPE-011", "DRIVE_ASSEMBLY", "Drive Assembly", "Motor and drive connection", 1),
    ("SUBU-059", "ETYPE-011", "MIXING_VESSEL", "Mixing Vessel", "Container for mixing operation", 2),
    ("SUBU-060", "ETYPE-011", "AGITATOR_SHAFT", "Agitator Shaft", "Shaft transmitting rotation to mixing element", 3),
    ("SUBU-061", "ETYPE-011", "MIXING_ELEMENT", "Mixing Element", "Impeller or mixing blade", 4),
    ("SUBU-062", "ETYPE-011", "SEALING_SYSTEM", "Sealing System", "Shaft sealing arrangement", 5),
    ("SUBU-063", "ETYPE-011", "BEARING_SYSTEM", "Bearing System", "Shaft support bearings", 6),
]

# Agitator subunits
agitator_subunits = [
    ("SUBU-064", "ETYPE-012", "DRIVE_ASSEMBLY", "Drive Assembly", "Motor and drive connection", 1),
    ("SUBU-065", "ETYPE-012", "MOUNTING_STRUCTURE", "Mounting Structure", "Support for agitator installation", 2),
    ("SUBU-066", "ETYPE-012", "AGITATOR_SHAFT", "Agitator Shaft", "Shaft transmitting rotation", 3),
    ("SUBU-067", "ETYPE-012", "AGITATOR_BLADE", "Agitator Blade", "Mixing blade or propeller", 4),
    ("SUBU-068", "ETYPE-012", "SEALING_SYSTEM", "Sealing System", "Shaft sealing arrangement", 5),
    ("SUBU-069", "ETYPE-012", "BEARING_SYSTEM", "Bearing System", "Shaft support bearings", 6),
]

# Electric Motor subunits
motor_subunits = [
    ("SUBU-070", "ETYPE-013", "STATOR_ASSEMBLY", "Stator Assembly", "Stationary electromagnetic components", 1),
    ("SUBU-071", "ETYPE-013", "ROTOR_ASSEMBLY", "Rotor Assembly", "Rotating electromagnetic components", 2),
    ("SUBU-072", "ETYPE-013", "BEARING_SYSTEM", "Bearing System", "Shaft support bearings", 3),
    ("SUBU-073", "ETYPE-013", "COOLING_SYSTEM", "Cooling System", "Heat removal system", 4),
    ("SUBU-074", "ETYPE-013", "CONNECTION_BOX", "Connection Box", "Electrical terminal housing", 5),
]

# AC Generator subunits
generator_subunits = [
    ("SUBU-075", "ETYPE-014", "STATOR_ASSEMBLY", "Stator Assembly", "Stationary electromagnetic components", 1),
    ("SUBU-076", "ETYPE-014", "ROTOR_ASSEMBLY", "Rotor Assembly", "Rotating field components", 2),
    ("SUBU-077", "ETYPE-014", "BEARING_SYSTEM", "Bearing System", "Shaft support bearings", 3),
    ("SUBU-078", "ETYPE-014", "COOLING_SYSTEM", "Cooling System", "Heat removal system", 4),
    ("SUBU-079", "ETYPE-014", "VOLTAGE_REGULATOR", "Voltage Regulator", "Output voltage control system", 5),
]

# Power Transformer subunits
power_xfrm_subunits = [
    ("SUBU-080", "ETYPE-015", "CORE_COIL_ASSEMBLY", "Core Coil Assembly", "Magnetic core and windings", 1),
    ("SUBU-081", "ETYPE-015", "TANK_ASSEMBLY", "Tank Assembly", "Oil-filled tank housing", 2),
    ("SUBU-082", "ETYPE-015", "BUSHING_ASSEMBLY", "Bushing Assembly", "High voltage bushings", 3),
    ("SUBU-083", "ETYPE-015", "COOLING_SYSTEM", "Cooling System", "Heat removal radiators or fans", 4),
    ("SUBU-084", "ETYPE-015", "TAP_CHANGER", "Tap Changer", "Voltage adjustment mechanism", 5),
]

# Distribution Transformer subunits
dist_xfrm_subunits = [
    ("SUBU-085", "ETYPE-016", "CORE_COIL_ASSEMBLY", "Core Coil Assembly", "Magnetic core and windings", 1),
    ("SUBU-086", "ETYPE-016", "ENCLOSURE", "Enclosure", "Protective housing", 2),
    ("SUBU-087", "ETYPE-016", "BUSHING_ASSEMBLY", "Bushing Assembly", "Terminal bushings", 3),
    ("SUBU-088", "ETYPE-016", "COOLING_SYSTEM", "Cooling System", "Natural or forced cooling", 4),
]

# Switchgear Panel subunits
switchgear_subunits = [
    ("SUBU-089", "ETYPE-017", "ENCLOSURE", "Enclosure", "Metal housing and doors", 1),
    ("SUBU-090", "ETYPE-017", "BUSBAR_SYSTEM", "Busbar System", "Main power conductors", 2),
    ("SUBU-091", "ETYPE-017", "CIRCUIT_BREAKER", "Circuit Breaker", "Primary switching device", 3),
    ("SUBU-092", "ETYPE-017", "PROTECTION_RELAY", "Protection Relay", "Fault detection and tripping", 4),
    ("SUBU-093", "ETYPE-017", "CONTROL_SYSTEM", "Control System", "Local control and indication", 5),
]

# UPS System subunits
ups_subunits = [
    ("SUBU-094", "ETYPE-018", "ENCLOSURE", "Enclosure", "Housing cabinet", 1),
    ("SUBU-095", "ETYPE-018", "RECTIFIER_UNIT", "Rectifier Unit", "AC to DC conversion", 2),
    ("SUBU-096", "ETYPE-018", "INVERTER_UNIT", "Inverter Unit", "DC to AC conversion", 3),
    ("SUBU-097", "ETYPE-018", "BATTERY_BANK", "Battery Bank", "Energy storage batteries", 4),
    ("SUBU-098", "ETYPE-018", "CONTROL_SYSTEM", "Control System", "Monitoring and control electronics", 5),
]

# Battery Bank subunits
battery_subunits = [
    ("SUBU-099", "ETYPE-019", "ENCLOSURE", "Enclosure", "Battery housing", 1),
    ("SUBU-100", "ETYPE-019", "BATTERY_CELL", "Battery Cell", "Individual battery units", 2),
    ("SUBU-101", "ETYPE-019", "CONNECTOR_ASSEMBLY", "Connector Assembly", "Inter-cell connections", 3),
    ("SUBU-102", "ETYPE-019", "MONITORING_SYSTEM", "Monitoring System", "Voltage and temperature monitoring", 4),
]

# VFD subunits
vfd_subunits = [
    ("SUBU-103", "ETYPE-020", "ENCLOSURE", "Enclosure", "Drive housing", 1),
    ("SUBU-104", "ETYPE-020", "POWER_MODULE", "Power Module", "Power electronic converter", 2),
    ("SUBU-105", "ETYPE-020", "CONTROL_MODULE", "Control Module", "Processor and control electronics", 3),
    ("SUBU-106", "ETYPE-020", "COOLING_SYSTEM", "Cooling System", "Heat removal system", 4),
    ("SUBU-107", "ETYPE-020", "OPERATOR_INTERFACE", "Operator Interface", "Keypad and display", 5),
]

# Pressure Gauge subunits
pressure_gauge_subunits = [
    ("SUBU-108", "ETYPE-021", "CASE_ASSEMBLY", "Case Assembly", "Instrument housing", 1),
    ("SUBU-109", "ETYPE-021", "DIAL_DISPLAY", "Dial Display", "Pressure indication dial", 2),
    ("SUBU-110", "ETYPE-021", "BOURDON_TUBE", "Bourdon Tube", "Pressure sensing element", 3),
    ("SUBU-111", "ETYPE-021", "CONNECTION_PORT", "Connection Port", "Process connection fitting", 4),
]

# Pressure Transmitter subunits
pressure_xmtr_subunits = [
    ("SUBU-112", "ETYPE-022", "ENCLOSURE", "Enclosure", "Housing and electronics", 1),
    ("SUBU-113", "ETYPE-022", "SENSOR_ELEMENT", "Sensor Element", "Pressure sensing diaphragm or cell", 2),
    ("SUBU-114", "ETYPE-022", "ELECTRONICS_MODULE", "Electronics Module", "Signal processing electronics", 3),
    ("SUBU-115", "ETYPE-022", "CONNECTION_PORT", "Connection Port", "Process and electrical connections", 4),
    ("SUBU-116", "ETYPE-022", "DISPLAY_INTERFACE", "Display Interface", "Local indicator", 5),
]

# Flowmeter subunits
flowmeter_subunits = [
    ("SUBU-117", "ETYPE-023", "BODY_ASSEMBLY", "Body Assembly", "Meter housing and flow tube", 1),
    ("SUBU-118", "ETYPE-023", "SENSOR_ELEMENT", "Sensor Element", "Flow sensing mechanism", 2),
    ("SUBU-119", "ETYPE-023", "ELECTRONICS_MODULE", "Electronics Module", "Signal processing and display", 3),
    ("SUBU-120", "ETYPE-023", "CONNECTION_PORT", "Connection Port", "Process and electrical connections", 4),
]

# Level Transmitter subunits
level_xmtr_subunits = [
    ("SUBU-121", "ETYPE-024", "ENCLOSURE", "Enclosure", "Housing and electronics", 1),
    ("SUBU-122", "ETYPE-024", "SENSOR_ELEMENT", "Sensor Element", "Level sensing mechanism", 2),
    ("SUBU-123", "ETYPE-024", "ELECTRONICS_MODULE", "Electronics Module", "Signal processing electronics", 3),
    ("SUBU-124", "ETYPE-024", "CONNECTION_PORT", "Connection Port", "Process and electrical connections", 4),
]

# Level Switch subunits
level_switch_subunits = [
    ("SUBU-125", "ETYPE-025", "ENCLOSURE", "Enclosure", "Switch housing", 1),
    ("SUBU-126", "ETYPE-025", "SWITCH_MECHANISM", "Switch Mechanism", "Level actuated switch", 2),
    ("SUBU-127", "ETYPE-025", "CONNECTION_PORT", "Connection Port", "Process and electrical connections", 3),
]

# Temperature Transmitter subunits
temp_xmtr_subunits = [
    ("SUBU-128", "ETYPE-026", "ENCLOSURE", "Enclosure", "Housing and electronics", 1),
    ("SUBU-129", "ETYPE-026", "SENSOR_ELEMENT", "Sensor Element", "Temperature sensing element", 2),
    ("SUBU-130", "ETYPE-026", "ELECTRONICS_MODULE", "Electronics Module", "Signal conditioning electronics", 3),
    ("SUBU-131", "ETYPE-026", "CONNECTION_PORT", "Connection Port", "Thermowell and electrical connections", 4),
]

# Temperature Gauge subunits
temp_gauge_subunits = [
    ("SUBU-132", "ETYPE-027", "CASE_ASSEMBLY", "Case Assembly", "Instrument housing", 1),
    ("SUBU-133", "ETYPE-027", "DIAL_DISPLAY", "Dial Display", "Temperature indication", 2),
    ("SUBU-134", "ETYPE-027", "BIOMETAL_ELEMENT", "Biometal Element", "Temperature sensing bimetal or bulb", 3),
    ("SUBU-135", "ETYPE-027", "THERMOWELL", "Thermowell", "Protection well for sensing element", 4),
]

# Process Analyzer subunits
analyzer_subunits = [
    ("SUBU-136", "ETYPE-028", "ENCLOSURE", "Enclosure", "Analyzer housing", 1),
    ("SUBU-137", "ETYPE-028", "SAMPLE_SYSTEM", "Sample System", "Sample conditioning and handling", 2),
    ("SUBU-138", "ETYPE-028", "ANALYZER_CELL", "Analyzer Cell", "Measurement sensor cell", 3),
    ("SUBU-139", "ETYPE-028", "ELECTRONICS_MODULE", "Electronics Module", "Signal processing and control", 4),
    ("SUBU-140", "ETYPE-028", "DISPLAY_INTERFACE", "Display Interface", "Readout and operator interface", 5),
]

# Gate Valve subunits
gate_valve_subunits = [
    ("SUBU-141", "ETYPE-029", "BODY_ASSEMBLY", "Body Assembly", "Valve body and bonnet", 1),
    ("SUBU-142", "ETYPE-029", "GATE_WEDGE", "Gate Wedge", "Closing gate or wedge", 2),
    ("SUBU-143", "ETYPE-029", "STEM_ASSEMBLY", "Stem Assembly", "Operating stem and nut", 3),
    ("SUBU-144", "ETYPE-029", "SEAT_RING", "Seat Ring", "Sealing seat surfaces", 4),
    ("SUBU-145", "ETYPE-029", "PACKING_SYSTEM", "Packing System", "Stem sealing arrangement", 5),
    ("SUBU-146", "ETYPE-029", "OPERATOR", "Operator", "Handwheel or actuator", 6),
]

# Ball Valve subunits
ball_valve_subunits = [
    ("SUBU-147", "ETYPE-030", "BODY_ASSEMBLY", "Body Assembly", "Valve body and end connections", 1),
    ("SUBU-148", "ETYPE-030", "BALL_ASSEMBLY", "Ball Assembly", "Rotating ball with port", 2),
    ("SUBU-149", "ETYPE-030", "SEAT_RING", "Seat Ring", "Sealing seat surfaces", 3),
    ("SUBU-150", "ETYPE-030", "STEM_ASSEMBLY", "Stem Assembly", "Ball stem and seals", 4),
    ("SUBU-151", "ETYPE-030", "OPERATOR", "Operator", "Lever or actuator", 5),
]

# Butterfly Valve subunits
butterfly_valve_subunits = [
    ("SUBU-152", "ETYPE-031", "BODY_ASSEMBLY", "Body Assembly", "Valve body and lug connections", 1),
    ("SUBU-153", "ETYPE-031", "DISC_ASSEMBLY", "Disc Assembly", "Rotating disc closure", 2),
    ("SUBU-154", "ETYPE-031", "SEAT_RING", "Seat Ring", "Sealing liner or seat", 3),
    ("SUBU-155", "ETYPE-031", "STEM_ASSEMBLY", "Stem Assembly", "Disc stem and seals", 4),
    ("SUBU-156", "ETYPE-031", "OPERATOR", "Operator", "Gear operator or actuator", 5),
]

# Globe Control Valve subunits
globe_valve_subunits = [
    ("SUBU-157", "ETYPE-032", "BODY_ASSEMBLY", "Body Assembly", "Globe-style valve body", 1),
    ("SUBU-158", "ETYPE-032", "PLUG_DISC", "Plug Disc", "Throttling plug or disc", 2),
    ("SUBU-159", "ETYPE-032", "SEAT_RING", "Seat Ring", "Seating surface", 3),
    ("SUBU-160", "ETYPE-032", "STEM_ASSEMBLY", "Stem Assembly", "Valve stem and packing", 4),
    ("SUBU-161", "ETYPE-032", "ACTUATOR", "Actuator", "Control actuator assembly", 5),
    ("SUBU-162", "ETYPE-032", "POSITIONER", "Positioner", "Valve position controller", 6),
]

# Relief Valve subunits
relief_valve_subunits = [
    ("SUBU-163", "ETYPE-033", "INLET_BODY", "Inlet Body", "Inlet nozzle and body", 1),
    ("SUBU-164", "ETYPE-033", "DISC_HOLDER", "Disc Holder", "Holding disc and guide", 2),
    ("SUBU-165", "ETYPE-033", "DISC_SEAT", "Disc Seat", "Sealing disc and seat", 3),
    ("SUBU-166", "ETYPE-033", "SPRING_ASSEMBLY", "Spring Assembly", "Compression spring", 4),
    ("SUBU-167", "ETYPE-033", "ADJUSTMENT_RING", "Adjustment Ring", "Blowdown adjustment", 5),
]

# Motorized Valve subunits
motorized_valve_subunits = [
    ("SUBU-168", "ETYPE-034", "VALVE_BODY", "Valve Body", "Base valve assembly", 1),
    ("SUBU-169", "ETYPE-034", "ELECTRIC_ACTUATOR", "Electric Actuator", "Motor and gear drive", 2),
    ("SUBU-170", "ETYPE-034", "LIMIT_SWITCHES", "Limit Switches", "Position feedback switches", 3),
    ("SUBU-171", "ETYPE-034", "CONTROL_SYSTEM", "Control System", "Motor controls and protection", 4),
]

# Pneumatic Actuated Valve subunits
pneumatic_valve_subunits = [
    ("SUBU-172", "ETYPE-035", "VALVE_BODY", "Valve Body", "Base valve assembly", 1),
    ("SUBU-173", "ETYPE-035", "PNEUMATIC_ACTUATOR", "Pneumatic Actuator", "Air-powered diaphragm or piston", 2),
    ("SUBU-174", "ETYPE-035", "POSITIONER", "Positioner", "Pneumatic position controller", 3),
    ("SUBU-175", "ETYPE-035", "SOLENOID_VALVE", "Solenoid Valve", "Pilot and control solenoids", 4),
]

# Pressure Vessel subunits
pressure_vessel_subunits = [
    ("SUBU-176", "ETYPE-036", "SHELL_ASSEMBLY", "Shell Assembly", "Pressure vessel shell", 1),
    ("SUBU-177", "ETYPE-036", "HEADS", "Heads", "End closures", 2),
    ("SUBU-178", "ETYPE-036", "NOZZLES", "Nozzles", "Inlet outlet and instrument nozzles", 3),
    ("SUBU-179", "ETYPE-036", "SUPPORTS", "Supports", "Saddle or skirt supports", 4),
    ("SUBU-180", "ETYPE-036", "INTERNALS", "Internals", "Tray packing or catalyst supports", 5),
]

# Storage Tank subunits
storage_tank_subunits = [
    ("SUBU-181", "ETYPE-037", "SHELL_ASSEMBLY", "Shell Assembly", "Tank shell and bottom", 1),
    ("SUBU-182", "ETYPE-037", "ROOF_ASSEMBLY", "Roof Assembly", "Fixed or floating roof", 2),
    ("SUBU-183", "ETYPE-037", "NOZZLES", "Nozzles", "Inlet outlet and vent nozzles", 3),
    ("SUBU-184", "ETYPE-037", "SUPPORTS", "Supports", "Foundation and support structure", 4),
    ("SUBU-185", "ETYPE-037", "ACCESSORIES", "Accessories", "Ladders platforms and gauges", 5),
]

# Shell and Tube Heat Exchanger subunits
shell_tube_hx_subunits = [
    ("SUBU-186", "ETYPE-038", "SHELL_ASSEMBLY", "Shell Assembly", "Outer pressure vessel", 1),
    ("SUBU-187", "ETYPE-038", "TUBE_BUNDLE", "Tube Bundle", "Heat transfer tubes and supports", 2),
    ("SUBU-188", "ETYPE-038", "CHANNEL", "Channel", "Tube-side inlet outlet chamber", 3),
    ("SUBU-189", "ETYPE-038", "TUBESHEET", "Tubesheet", "Tube support and sealing plate", 4),
    ("SUBU-190", "ETYPE-038", "BAFFLES", "Baffles", "Shell-side flow directors", 5),
]

# Plate Heat Exchanger subunits
plate_hx_subunits = [
    ("SUBU-191", "ETYPE-039", "FRAME_PLATE", "Frame Plate", "Fixed and movable frame plates", 1),
    ("SUBU-192", "ETYPE-039", "HEAT_PLATES", "Heat Plates", "Corrugated heat transfer plates", 2),
    ("SUBU-193", "ETYPE-039", "GASKETS", "Gaskets", "Plate sealing gaskets", 3),
    ("SUBU-194", "ETYPE-039", "COMPRESSION_BOLTS", "Compression Bolts", "Plate pack compression system", 4),
    ("SUBU-195", "ETYPE-039", "CONNECTION_PORTS", "Connection Ports", "Inlet and outlet nozzles", 5),
]

# Filter Housing subunits
filter_housing_subunits = [
    ("SUBU-196", "ETYPE-040", "HOUSING", "Housing", "Filter vessel body", 1),
    ("SUBU-197", "ETYPE-040", "COVER", "Cover", "Removable access cover", 2),
    ("SUBU-198", "ETYPE-040", "FILTER_ELEMENT", "Filter Element", "Replaceable filter media", 3),
    ("SUBU-199", "ETYPE-040", "SEAL_GASKET", "Seal Gasket", "Cover sealing gasket", 4),
    ("SUBU-200", "ETYPE-040", "DIFFERENTIAL_GAUGE", "Differential Gauge", "Pressure drop indicator", 5),
]

# Separator Vessel subunits
separator_subunits = [
    ("SUBU-201", "ETYPE-041", "SHELL_ASSEMBLY", "Shell Assembly", "Pressure vessel body", 1),
    ("SUBU-202", "ETYPE-041", "INLET_DEVICE", "Inlet Device", "Flow distribution inlet", 2),
    ("SUBU-203", "ETYPE-041", "SEPARATION_ELEMENT", "Separation Element", "Mist pad cyclone or coalescer", 3),
    ("SUBU-204", "ETYPE-041", "OUTLET_DEVICE", "Outlet Device", "Separated phase outlet", 4),
    ("SUBU-205", "ETYPE-041", "LEVEL_CONTROL", "Level Control", "Interface level control", 5),
]

# Pipeline subunits
pipeline_subunits = [
    ("SUBU-206", "ETYPE-042", "PIPE_SECTION", "Pipe Section", "Straight pipe segments", 1),
    ("SUBU-207", "ETYPE-042", "VALVES", "Valves", "Inline isolation and control valves", 2),
    ("SUBU-208", "ETYPE-042", "SUPPORTS", "Supports", "Pipeline supports and anchors", 3),
    ("SUBU-209", "ETYPE-042", "INSULATION", "Insulation", "Thermal insulation system", 4),
    ("SUBU-210", "ETYPE-042", "MARKERS", "Markers", "Line markers and signage", 5),
]

# Piping System subunits
piping_system_subunits = [
    ("SUBU-211", "ETYPE-043", "HEADER", "Header", "Distribution or collection header", 1),
    ("SUBU-212", "ETYPE-043", "BRANCH_LINES", "Branch Lines", "Connecting branch piping", 2),
    ("SUBU-213", "ETYPE-043", "VALVES", "Valves", "System valves", 3),
    ("SUBU-214", "ETYPE-043", "SUPPORTS", "Supports", "Pipe supports", 4),
]

# Pipe Fitting subunits
pipe_fitting_subunits = [
    ("SUBU-215", "ETYPE-044", "FITTING_BODY", "Fitting Body", "Elbow tee reducer body", 1),
    ("SUBU-216", "ETYPE-044", "END_CONNECTIONS", "End Connections", "Welded or flanged ends", 2),
]

# Strainer subunits
strainer_subunits = [
    ("SUBU-217", "ETYPE-045", "BODY", "Body", "Strainer housing", 1),
    ("SUBU-218", "ETYPE-045", "COVER", "Cover", "Removable access cover", 2),
    ("SUBU-219", "ETYPE-045", "SCREEN_ELEMENT", "Screen Element", "Mesh or perforated screen", 3),
    ("SUBU-220", "ETYPE-045", "BLOWDOWN_VALVE", "Blowdown Valve", "Cleaning outlet valve", 4),
]

# Chiller subunits
chiller_subunits = [
    ("SUBU-221", "ETYPE-046", "COMPRESSOR", "Compressor", "Refrigeration compressor", 1),
    ("SUBU-222", "ETYPE-046", "CONDENSER", "Condenser", "Heat rejection coil", 2),
    ("SUBU-223", "ETYPE-046", "EVAPORATOR", "Evaporator", "Cooling coil", 3),
    ("SUBU-224", "ETYPE-046", "EXPANSION_DEVICE", "Expansion Device", "Thermal expansion valve", 4),
    ("SUBU-225", "ETYPE-046", "CONTROL_SYSTEM", "Control System", "Temperature and operation controls", 5),
]

# Cooling Tower subunits
cooling_tower_subunits = [
    ("SUBU-226", "ETYPE-047", "BASIN_STRUCTURE", "Basin Structure", "Collection basin and framework", 1),
    ("SUBU-227", "ETYPE-047", "FILL_MEDIA", "Fill Media", "Heat transfer packing", 2),
    ("SUBU-228", "ETYPE-047", "FAN_ASSEMBLY", "Fan Assembly", "Induced or forced draft fan", 3),
    ("SUBU-229", "ETYPE-047", "DISTRIBUTION_SYSTEM", "Distribution System", "Water distribution header and nozzles", 4),
    ("SUBU-230", "ETYPE-047", "DRIVE_ASSEMBLY", "Drive Assembly", "Motor and gear drive", 5),
]

# Air Handling Unit subunits
ahu_subunits = [
    ("SUBU-231", "ETYPE-048", "CASING", "Casing", "Unit housing", 1),
    ("SUBU-232", "ETYPE-048", "FAN_ASSEMBLY", "Fan Assembly", "Supply and return fans", 2),
    ("SUBU-233", "ETYPE-048", "COOLING_COIL", "Cooling Coil", "Refrigerant or chilled water coil", 3),
    ("SUBU-234", "ETYPE-048", "HEATING_COIL", "Heating Coil", "Steam or hot water coil", 4),
    ("SUBU-235", "ETYPE-048", "FILTER_SECTION", "Filter Section", "Air filtration", 5),
    ("SUBU-236", "ETYPE-048", "DAMPERS", "Dampers", "Control dampers", 6),
]

# Fan Coil Unit subunits
fcu_subunits = [
    ("SUBU-237", "ETYPE-049", "CASING", "Casing", "Unit enclosure", 1),
    ("SUBU-238", "ETYPE-049", "FAN_ASSEMBLY", "Fan Assembly", "Fan and motor", 2),
    ("SUBU-239", "ETYPE-049", "COIL_ASSEMBLY", "Coil Assembly", "Heating cooling coil", 3),
    ("SUBU-240", "ETYPE-049", "FILTER", "Filter", "Air filter", 4),
    ("SUBU-241", "ETYPE-049", "CONTROL_VALVE", "Control Valve", "Water control valve", 5),
]

# Equipment Support subunits
equipment_support_subunits = [
    ("SUBU-242", "ETYPE-050", "FRAME_STRUCTURE", "Frame Structure", "Structural frame members", 1),
    ("SUBU-243", "ETYPE-050", "BASE_PLATE", "Base Plate", "Equipment mounting surface", 2),
    ("SUBU-244", "ETYPE-050", "ANCHOR_BOLTS", "Anchor Bolts", "Foundation anchorage", 3),
    ("SUBU-245", "ETYPE-050", "GRATING", "Grating", "Access flooring", 4),
]

# Platform subunits
platform_subunits = [
    ("SUBU-246", "ETYPE-051", "DECKING", "Decking", "Platform surface", 1),
    ("SUBU-247", "ETYPE-051", "SUPPORT_BEAMS", "Support Beams", "Structural support members", 2),
    ("SUBU-248", "ETYPE-051", "GUARDRAIL", "Guardrail", "Perimeter fall protection", 3),
    ("SUBU-249", "ETYPE-051", "TOE_BOARD", "Toe Board", "Base kick plate", 4),
]

# Ladder subunits
ladder_subunits = [
    ("SUBU-250", "ETYPE-052", "SIDE_RAILS", "Side Rails", "Vertical support rails", 1),
    ("SUBU-251", "ETYPE-052", "RUNGS", "Rungs", "Horizontal climbing steps", 2),
    ("SUBU-252", "ETYPE-052", "SAFETY_CAGE", "Safety Cage", "Fall protection enclosure", 3),
    ("SUBU-253", "ETYPE-052", "MOUNTING_BRACKETS", "Mounting Brackets", "Wall mounting hardware", 4),
]

# Fire Pump System subunits
fire_pump_subunits = [
    ("SUBU-254", "ETYPE-053", "PUMP_UNIT", "Pump Unit", "Main fire pump", 1),
    ("SUBU-255", "ETYPE-053", "DRIVER", "Driver", "Electric motor or engine", 2),
    ("SUBU-256", "ETYPE-053", "CONTROLLER", "Controller", "Fire pump controller", 3),
    ("SUBU-257", "ETYPE-053", "PIPING_VALVES", "Piping Valves", "System valves and piping", 4),
    ("SUBU-258", "ETYPE-053", "METERING", "Metering", "Flow and pressure metering", 5),
]

# Fire Suppression Panel subunits
fire_panel_subunits = [
    ("SUBU-259", "ETYPE-054", "ENCLOSURE", "Enclosure", "Control panel housing", 1),
    ("SUBU-260", "ETYPE-054", "CONTROL_MODULE", "Control Module", "Suppression control electronics", 2),
    ("SUBU-261", "ETYPE-054", "RELEASE_CIRCUIT", "Release Circuit", "Agent release mechanism", 3),
    ("SUBU-262", "ETYPE-054", "DETECTION_INPUT", "Detection Input", "Detector input circuits", 4),
]

# Fixed Gas Detector subunits
gas_detector_subunits = [
    ("SUBU-263", "ETYPE-055", "ENCLOSURE", "Enclosure", "Detector housing", 1),
    ("SUBU-264", "ETYPE-055", "SENSOR_HEAD", "Sensor Head", "Gas sensing element", 2),
    ("SUBU-265", "ETYPE-055", "ELECTRONICS", "Electronics", "Signal processing", 3),
    ("SUBU-266", "ETYPE-055", "CONNECTION_PORT", "Connection Port", "Wiring conduit entry", 4),
]

# Safety Shower subunits
safety_shower_subunits = [
    ("SUBU-267", "ETYPE-056", "VALVE_ASSEMBLY", "Valve Assembly", "Water control valve", 1),
    ("SUBU-268", "ETYPE-056", "PIPING", "Piping", "Water supply piping", 2),
    ("SUBU-269", "ETYPE-056", "SHOWER_HEAD", "Shower Head", "Spray distribution head", 3),
    ("SUBU-270", "ETYPE-056", "ACTIVATION_DEVICE", "Activation Device", "Pull handle or sensor", 4),
]

# Eyewash Station subunits
eyewash_subunits = [
    ("SUBU-271", "ETYPE-057", "VALVE_ASSEMBLY", "Valve Assembly", "Water control valve", 1),
    ("SUBU-272", "ETYPE-057", "PIPING", "Piping", "Water supply piping", 2),
    ("SUBU-273", "ETYPE-057", "NOZZLE_ASSEMBLY", "Nozzle Assembly", "Eye wash spray nozzles", 3),
    ("SUBU-274", "ETYPE-057", "BASIN", "Basin", "Collection basin", 4),
]

# Boiler subunits
boiler_subunits = [
    ("SUBU-275", "ETYPE-058", "PRESSURE_VESSEL", "Pressure Vessel", "Steam or water drum", 1),
    ("SUBU-276", "ETYPE-058", "BURNER_SYSTEM", "Burner System", "Fuel combustion system", 2),
    ("SUBU-277", "ETYPE-058", "HEAT_EXCHANGER", "Heat Exchanger", "Tube bank or coil", 3),
    ("SUBU-278", "ETYPE-058", "CONTROLS", "Controls", "Combustion and level controls", 4),
    ("SUBU-279", "ETYPE-058", "SAFETY_DEVICES", "Safety Devices", "Relief valves and interlocks", 5),
]

# Water Treatment Unit subunits
water_treatment_subunits = [
    ("SUBU-280", "ETYPE-059", "REACTION_VESSEL", "Reaction Vessel", "Treatment tank or chamber", 1),
    ("SUBU-281", "ETYPE-059", "MEDIA_BED", "Media Bed", "Treatment media or resin", 2),
    ("SUBU-282", "ETYPE-059", "DISTRIBUTION_SYSTEM", "Distribution System", "Flow distribution", 3),
    ("SUBU-283", "ETYPE-059", "CONTROL_VALVES", "Control Valves", "Process and regeneration valves", 4),
    ("SUBU-284", "ETYPE-059", "INSTRUMENTATION", "Instrumentation", "Monitoring sensors and gauges", 5),
]

# Air Dryer subunits
air_dryer_subunits = [
    ("SUBU-285", "ETYPE-060", "COMPRESSOR_UNIT", "Compressor Unit", "Refrigeration compressor", 1),
    ("SUBU-286", "ETYPE-060", "HEAT_EXCHANGER", "Heat Exchanger", "Refrigerant condenser", 2),
    ("SUBU-287", "ETYPE-060", "EVAPORATOR", "Evaporator", "Refrigerant evaporator", 3),
    ("SUBU-288", "ETYPE-060", "CONTROL_SYSTEM", "Control System", "Dewpoint and cycling controls", 4),
]

# Combine all subunits
all_subunits = []
for subunit_list in [
    pump_subunits, pd_pump_subunits, recip_comp_subunits, rotary_comp_subunits,
    steam_turbine_subunits, gas_turbine_subunits, centrifugal_fan_subunits,
    axial_fan_subunits, blower_subunits, gearbox_subunits, mixer_subunits,
    agitator_subunits, motor_subunits, generator_subunits, power_xfrm_subunits,
    dist_xfrm_subunits, switchgear_subunits, ups_subunits, battery_subunits,
    vfd_subunits, pressure_gauge_subunits, pressure_xmtr_subunits, flowmeter_subunits,
    level_xmtr_subunits, level_switch_subunits, temp_xmtr_subunits, temp_gauge_subunits,
    analyzer_subunits, gate_valve_subunits, ball_valve_subunits, butterfly_valve_subunits,
    globe_valve_subunits, relief_valve_subunits, motorized_valve_subunits,
    pneumatic_valve_subunits, pressure_vessel_subunits, storage_tank_subunits,
    shell_tube_hx_subunits, plate_hx_subunits, filter_housing_subunits,
    separator_subunits, pipeline_subunits, piping_system_subunits, pipe_fitting_subunits,
    strainer_subunits, chiller_subunits, cooling_tower_subunits, ahu_subunits,
    fcu_subunits, equipment_support_subunits, platform_subunits, ladder_subunits,
    fire_pump_subunits, fire_panel_subunits, gas_detector_subunits,
    safety_shower_subunits, eyewash_subunits, boiler_subunits, water_treatment_subunits,
    air_dryer_subunits
]:
    for sub in subunit_list:
        all_subunits.append({
            "id": sub[0],
            "equipment_type_id": sub[1],
            "code": sub[2],
            "name": sub[3],
            "description": sub[4],
            "sequence_no": sub[5],
            "is_active": True
        })

# Generate maintainable items
# This is a simplified set - in production, each equipment type would have detailed items
maintainable_items = []
mi_counter = 1

# Define maintainable items for key equipment types
mi_definitions = {
    # Centrifugal Pump items
    "ETYPE-001": [
        ("SUBU-001", "COUPLING", "Coupling", "Flexible or rigid shaft coupling"),
        ("SUBU-001", "GUARD", "Guard", "Coupling safety guard"),
        ("SUBU-002", "COUPLING_ELEMENT", "Coupling Element", "Insert or spider element"),
        ("SUBU-002", "FASTENERS", "Fasteners", "Coupling bolts and hardware"),
        ("SUBU-003", "CASING", "Casing", "Pump casing"),
        ("SUBU-003", "WEAR_RING", "Wear Ring", "Casing wear ring"),
        ("SUBU-004", "IMPELLER", "Impeller", "Pump impeller"),
        ("SUBU-004", "SHAFT", "Shaft", "Pump shaft"),
        ("SUBU-004", "KEY", "Key", "Shaft key"),
        ("SUBU-005", "BEARING_DE", "Bearing DE", "Drive end bearing"),
        ("SUBU-005", "BEARING_NDE", "Bearing NDE", "Non-drive end bearing"),
        ("SUBU-005", "BEARING_HOUSING", "Bearing Housing", "Bearing support housing"),
        ("SUBU-006", "MECHANICAL_SEAL", "Mechanical Seal", "Shaft mechanical seal"),
        ("SUBU-006", "GLAND_PACKING", "Gland Packing", "Packing rings and gland"),
        ("SUBU-006", "SEAL_POT", "Seal Pot", "Barrier fluid reservoir"),
    ],
    # Electric Motor items
    "ETYPE-013": [
        ("SUBU-070", "STATOR_WINDING", "Stator Winding", "Stationary coil winding"),
        ("SUBU-070", "STATOR_CORE", "Stator Core", "Laminated iron core"),
        ("SUBU-071", "ROTOR", "Rotor", "Rotating squirrel cage or wound rotor"),
        ("SUBU-072", "BEARING_DE", "Bearing DE", "Drive end bearing"),
        ("SUBU-072", "BEARING_NDE", "Bearing NDE", "Non-drive end bearing"),
        ("SUBU-073", "FAN", "Fan", "Cooling fan"),
        ("SUBU-073", "FAN_COVER", "Fan Cover", "Fan guard and cover"),
        ("SUBU-074", "TERMINAL_BLOCK", "Terminal Block", "Power connection terminals"),
        ("SUBU-074", "CONDUIT_BOX", "Conduit Box", "Wiring enclosure"),
    ],
    # Gate Valve items
    "ETYPE-029": [
        ("SUBU-141", "BODY", "Body", "Valve pressure boundary"),
        ("SUBU-141", "BONNET", "Bonnet", "Cover for valve internals"),
        ("SUBU-142", "WEDGE", "Wedge", "Closing gate element"),
        ("SUBU-143", "STEM", "Stem", "Operating stem"),
        ("SUBU-143", "STEM_NUT", "Stem Nut", "Threaded nut for stem"),
        ("SUBU-144", "SEAT_RING", "Seat Ring", "Sealing surface"),
        ("SUBU-145", "PACKING", "Packing", "Stem seal packing"),
        ("SUBU-145", "GLAND", "Gland", "Packing compression follower"),
        ("SUBU-146", "HANDWHEEL", "Handwheel", "Manual operator"),
    ],
    # Shell and Tube Heat Exchanger items
    "ETYPE-038": [
        ("SUBU-186", "SHELL", "Shell", "Pressure vessel shell"),
        ("SUBU-186", "SHELL_NOZZLES", "Shell Nozzles", "Inlet outlet connections"),
        ("SUBU-187", "TUBES", "Tubes", "Heat transfer tubes"),
        ("SUBU-187", "TIE_RODS", "Tie Rods", "Bundle support rods"),
        ("SUBU-188", "CHANNEL", "Channel", "Channel cover or bonnet"),
        ("SUBU-188", "CHANNEL_NOZZLES", "Channel Nozzles", "Tube-side connections"),
        ("SUBU-189", "TUBESHEET", "Tubesheet", "Tube support plate"),
        ("SUBU-189", "TUBE_GASKET", "Tube Gasket", "Channel gasket"),
        ("SUBU-190", "BAFFLES", "Baffles", "Flow directors"),
    ],
}

# Generate items for defined equipment types
for etype_id, items in mi_definitions.items():
    for item in items:
        subunit_id = item[0]
        code = item[1]
        name = item[2]
        desc = item[3]
        mi_id = f"MI-{mi_counter:04d}"
        maintainable_items.append({
            "id": mi_id,
            "equipment_type_id": etype_id,
            "subunit_id": subunit_id,
            "code": code,
            "name": name,
            "description": desc,
            "inspectable": True,
            "replaceable": True,
            "sequence_no": 1,
            "is_active": True
        })
        mi_counter += 1

# Generate generic items for remaining equipment types (simplified)
generic_items = [
    ("HOUSING", "Housing", "Main enclosure or body"),
    ("SEAL", "Seal", "Gasket or seal element"),
    ("FASTENER", "Fastener", "Bolts screws nuts"),
    ("BEARING", "Bearing", "Support bearing"),
    ("FILTER_ELEMENT", "Filter Element", "Replaceable filter"),
]

for etype in equipment_types:
    if etype["id"] not in mi_definitions:
        # Find subunits for this equipment type
        type_subunits = [s for s in all_subunits if s["equipment_type_id"] == etype["id"]]
        for i, subunit in enumerate(type_subunits[:3]):  # Add items to first 3 subunits
            for j, generic in enumerate(generic_items[:2]):
                mi_id = f"MI-{mi_counter:04d}"
                maintainable_items.append({
                    "id": mi_id,
                    "equipment_type_id": etype["id"],
                    "subunit_id": subunit["id"],
                    "code": generic[0],
                    "name": generic[1],
                    "description": generic[2],
                    "inspectable": True,
                    "replaceable": True,
                    "sequence_no": j + 1,
                    "is_active": True
                })
                mi_counter += 1

# Naming Conventions
naming_conventions = {
    "display_name_style": "Title Case with spaces between words",
    "code_style": "UPPER_SNAKE_CASE - all uppercase with underscores",
    "number_style": "Sequential numbers with zero-padding for consistent width",
    "noun_style": "Singular nouns only - no plurals",
    "neutrality_rule": "No tenant-specific, site-specific, process-specific, or duty-specific terminology",
    "equipment_type_rule": "Generic equipment category only - no size model manufacturer rating",
    "subunit_rule": "Assembly-oriented functional groupings (3-6 per equipment type)",
    "maintainable_item_rule": "Component-oriented inspectable and replaceable parts",
    "examples_good": [
        "Centrifugal Pump",
        "Mechanical Seal",
        "Bearing Assembly",
        "Pressure Transmitter"
    ],
    "examples_bad": [
        "Manila Water Transfer Pump",
        "10HP Motor",
        "Grundfos Pump CR10-05",
        "Boiler Feed Pump"
    ]
}

# Future Addition Rules
future_addition_rules = [
    "New records must fit one and only one ISO hierarchy path",
    "Add a new equipment_type only when inspection content differs materially from existing types",
    "Do not create new equipment_type for service, duty, manufacturer, model, size, or tenant naming",
    "Asset-specific details belong in asset master data, not taxonomy",
    "Records may be deactivated but not deleted when referenced historically",
    "New subunits must follow assembly-oriented grouping convention",
    "New maintainable items must be field-inspectable or replaceable components"
]

# Template Link Rule
template_link_rule = {
    "link_to": "equipment_type_id",
    "link_only_to": "equipment_type_id",
    "do_not_link_to": [
        "facility_id",
        "asset_id",
        "sap_functional_location",
        "equipment_class_id",
        "subunit_id",
        "maintainable_item_id"
    ]
}

# Inspection Level Rule
inspection_level_rule = {
    "lowest_level_for_inspection_point": "maintainable_item_id",
    "do_not_attach_inspection_points_to": [
        "equipment_category_id",
        "equipment_class_id",
        "equipment_type_id",
        "subunit_id"
    ]
}

# Consistency Rules
consistency_rules = [
    "Each equipment_type appears once only in one equipment_class",
    "Classes are mutually exclusive at taxonomy level",
    "Common parts reuse the same names across families where function is equivalent",
    "Static equipment terminology stays consistent",
    "Electrical terminology stays consistent",
    "Instrumentation terminology stays consistent",
    "Valve terminology stays consistent",
    "All codes are unique within their table",
    "All codes are stable and immutable once assigned",
    "Foreign key relationships must be resolvable"
]

# ODM Taxonomy Summary
odm_taxonomy_summary = {
    "taxonomy_anchor_for_templates": "equipment_type_id",
    "lowest_component_for_inspection_points": "maintainable_item_id",
    "sap_functional_location_replication": False,
    "sap_catalog_hierarchy_replication": False,
    "smp_family_usage": False,
    "multi_tenant_ready": True,
    "mobile_friendly": True,
    "cross_industry_neutral": True
}

# Assemble complete taxonomy
taxonomy = {
    "equipment_categories": equipment_categories,
    "equipment_classes": equipment_classes,
    "equipment_types": equipment_types,
    "subunits": all_subunits,
    "maintainable_items": maintainable_items,
    "naming_conventions": naming_conventions,
    "future_addition_rules": future_addition_rules,
    "template_link_rule": template_link_rule,
    "inspection_level_rule": inspection_level_rule,
    "consistency_rules": consistency_rules,
    "odm_taxonomy_summary": odm_taxonomy_summary
}

# Resolve every output path from THIS script's own location. Bare relative paths
# previously wrote the artifact into whichever directory the command was run
# from, which produced unexplained duplicate copies with ambiguous ownership.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SCRIPT_DIR)
DESIGN_ARTIFACT = os.path.join(_SCRIPT_DIR, "odm_legacy_equipment_taxonomy_design.v1.json")
SEED_COPY = os.path.join(_REPO_ROOT, "odm_seed", "master_data", "taxonomy.v1.json")

# Write both outputs from the same in-memory dataset so the design artifact and
# the seed copy can never silently drift apart.
for _out_path in (DESIGN_ARTIFACT, SEED_COPY):
    with open(_out_path, "w") as f:
        json.dump(taxonomy, f, indent=2)

print("Generated ODM legacy equipment taxonomy design (ISO 14224-informed; NOT an ISO extract):")
print(f"  - Equipment Categories: {len(equipment_categories)}")
print(f"  - Equipment Classes: {len(equipment_classes)}")
print(f"  - Equipment Types: {len(equipment_types)}")
print(f"  - Subunits: {len(all_subunits)}")
print(f"  - Maintainable Items: {len(maintainable_items)}")
print(f"\nAuthoritative design artifact: {os.path.relpath(DESIGN_ARTIFACT, _REPO_ROOT)}")
print(f"Seed copy (import input):      {os.path.relpath(SEED_COPY, _REPO_ROOT)}")

