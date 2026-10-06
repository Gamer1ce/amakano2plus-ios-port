#!/usr/bin/env python3
"""Generate a deterministic Xcode project without third-party packages."""
from pathlib import Path
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--full", action="store_true", help="Use full-game identity after the asset gate has passed")
args = parser.parse_args()

root = Path(__file__).resolve().parent
if args.full:
    from content_validation import verify_content
    try:
        verify_content(root / "Content", False)
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit(f"Cannot generate full-content identity: {error}")
project = root / "AmakanoPort.xcodeproj"
project.mkdir(exist_ok=True)
source = '''// !$*UTF8*$!
{
 archiveVersion = 1;
 classes = {};
 objectVersion = 56;
 objects = {
  A00000000000000000000001 = {isa = PBXBuildFile; fileRef = A00000000000000000000010; };
  A00000000000000000000002 = {isa = PBXBuildFile; fileRef = A00000000000000000000011; };
  A00000000000000000000003 = {isa = PBXBuildFile; fileRef = A00000000000000000000014; };
  A00000000000000000000004 = {isa = PBXBuildFile; fileRef = A00000000000000000000015; };
  A00000000000000000000010 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = App/GameApp.swift; sourceTree = "<group>"; };
  A00000000000000000000011 = {isa = PBXFileReference; lastKnownFileType = folder; path = Content; sourceTree = "<group>"; };
  A00000000000000000000012 = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = App/Info.plist; sourceTree = "<group>"; };
  A00000000000000000000013 = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = AmakanoPort.app; sourceTree = BUILT_PRODUCTS_DIR; };
  A00000000000000000000014 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = App/LocalFileRequest.swift; sourceTree = "<group>"; };
  A00000000000000000000015 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = App/LocalByteRange.swift; sourceTree = "<group>"; };
  A00000000000000000000020 = {isa = PBXGroup; children = (A00000000000000000000010, A00000000000000000000014, A00000000000000000000015, A00000000000000000000012, A00000000000000000000011, A00000000000000000000021); sourceTree = "<group>"; };
  A00000000000000000000021 = {isa = PBXGroup; children = (A00000000000000000000013); name = Products; sourceTree = "<group>"; };
  A00000000000000000000030 = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000001, A00000000000000000000003, A00000000000000000000004); runOnlyForDeploymentPostprocessing = 0; };
  A00000000000000000000031 = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000002); runOnlyForDeploymentPostprocessing = 0; };
  A00000000000000000000032 = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
  A00000000000000000000040 = {isa = PBXNativeTarget; buildConfigurationList = A00000000000000000000061; buildPhases = (A00000000000000000000030, A00000000000000000000032, A00000000000000000000031); buildRules = (); dependencies = (); name = AmakanoPort; productName = AmakanoPort; productReference = A00000000000000000000013; productType = "com.apple.product-type.application"; };
  A00000000000000000000050 = {isa = PBXProject; attributes = {BuildIndependentTargetsInParallel = YES; LastSwiftUpdateCheck = 2600; LastUpgradeCheck = 2600; TargetAttributes = {A00000000000000000000040 = {CreatedOnToolsVersion = 26.0; ProvisioningStyle = Automatic; }; }; }; buildConfigurationList = A00000000000000000000060; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base, "zh-Hans"); mainGroup = A00000000000000000000020; productRefGroup = A00000000000000000000021; projectDirPath = ""; projectRoot = ""; targets = (A00000000000000000000040); };
  A00000000000000000000060 = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000070, A00000000000000000000071); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
  A00000000000000000000061 = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000072, A00000000000000000000073); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
  A00000000000000000000070 = {isa = XCBuildConfiguration; buildSettings = {CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; }; name = Debug; };
  A00000000000000000000071 = {isa = XCBuildConfiguration; buildSettings = {CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; }; name = Release; };
  A00000000000000000000072 = {isa = XCBuildConfiguration; buildSettings = {CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = NO; INFOPLIST_FILE = App/Info.plist; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks"; MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = local.amakano2plus.preview; PRODUCT_NAME = "$(TARGET_NAME)"; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; TARGETED_DEVICE_FAMILY = "1,2"; SUPPORTS_MACCATALYST = NO; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; ENABLE_USER_SCRIPT_SANDBOXING = YES; }; name = Debug; };
  A00000000000000000000073 = {isa = XCBuildConfiguration; buildSettings = {CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = NO; INFOPLIST_FILE = App/Info.plist; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks"; MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = local.amakano2plus.preview; PRODUCT_NAME = "$(TARGET_NAME)"; SWIFT_COMPILATION_MODE = wholemodule; SWIFT_OPTIMIZATION_LEVEL = "-O"; TARGETED_DEVICE_FAMILY = "1,2"; SUPPORTS_MACCATALYST = NO; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; ENABLE_USER_SCRIPT_SANDBOXING = YES; }; name = Release; };
 };
 rootObject = A00000000000000000000050;
}
'''
if args.full:
    source = source.replace("local.amakano2plus.preview", "local.amakano2plus")
display_name = "甜蜜女友2＋" if args.full else "甜蜜女友2＋预览"
source = source.replace("PRODUCT_NAME =", f'GAME_DISPLAY_NAME = "{display_name}"; PRODUCT_NAME =')
(project / "project.pbxproj").write_text(source, encoding="utf-8")
schemes = project / "xcshareddata/xcschemes"
schemes.mkdir(parents=True, exist_ok=True)
ref = '<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A00000000000000000000040" BuildableName="AmakanoPort.app" BlueprintName="AmakanoPort" ReferencedContainer="container:AmakanoPort.xcodeproj"/>'
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref}</BuildActionEntry></BuildActionEntries></BuildAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/>
<ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''
(schemes / "AmakanoPort.xcscheme").write_text(scheme, encoding="utf-8")
diagnostics = scheme.replace('</LaunchAction>', '<CommandLineArguments><CommandLineArgument argument="--diagnostics" isEnabled="YES"/></CommandLineArguments></LaunchAction>')
(schemes / "AmakanoDiagnostics.xcscheme").write_text(diagnostics, encoding="utf-8")
print("Created", project)
