import XCTest
import UIKit

final class LaunchTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    private func assertHome(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "App exited during launch", file: file, line: line)
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30), "Bundled WebView did not load", file: file, line: line)
        XCTAssertTrue(app.buttons["Create event"].firstMatch.waitForExistence(timeout: 30), "Events UI did not render", file: file, line: line)
        XCTAssertTrue(app.buttons["Create event"].firstMatch.isHittable, file: file, line: line)
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testRepeatedColdLaunchAndInteractiveWebUI() {
        let app = XCUIApplication()
        for attempt in 1...3 {
            app.launch()
            assertHome(app)
            app.buttons["Create event"].firstMatch.tap()
            XCTAssertTrue(app.buttons["Try a KoC demo"].waitForExistence(timeout: 10))
            app.buttons["Close"].firstMatch.tap()
            assertHome(app)
            screenshot("cold-launch-\(attempt)")
            app.terminate()
            XCTAssertTrue(app.wait(for: .notRunning, timeout: 10))
        }
    }

    func testLandscapeAndBackgroundResume() {
        let app = XCUIApplication()
        app.launch()
        assertHome(app)
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait, .landscapeRight] {
            XCUIDevice.shared.orientation = orientation
            assertHome(app)
            screenshot("orientation-\(orientation.rawValue)")
        }
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
        app.activate()
        assertHome(app)
        // Exercise React and native WebView interaction after the scene reconnects.
        app.buttons["Create event"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Try a KoC demo"].waitForExistence(timeout: 10))
        app.buttons["Close"].firstMatch.tap()
        screenshot("resumed-landscape")
    }
}
