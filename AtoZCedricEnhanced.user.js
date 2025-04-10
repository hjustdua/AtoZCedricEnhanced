// ==UserScript==
// @name         AtoZ Cedric Enhanced
// @namespace    https://atoz.amazon.work
// @version      1.3
// @description  Calculator AtoZ English with Schedule Button Auto-Click and Time Tracking
// @author       @hjustdua
// @match        https://atoz.amazon.work/timecard*
// @match        https://atoz.amazon.work/schedule*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // Constants
    const TITLE_FORMATS = {
        SIMPLE: 0,     // (1h 23m) A to Z
        DETAILED: 1,   // 1:23 remaining - A to Z
        MINIMAL: 2     // 1:23 - A to Z
    };

    const FIXED_MAX_BREAK = 45;

    const TRANSLATIONS = {
        IN: ['Clock in', 'Punch in', 'In'],
        OUT: ['Clock out', 'Punch out', 'Out'],
        MISSING: ['Missing punch', 'Missed Punch', 'Missed punch', '--:--']
    };

    const COLORS = {
        GREEN: {
            bg: '#c6efce',
            text: '#006100'
        },
        YELLOW: {
            bg: '#ffeb9c',
            text: '#9c6500'
        },
        RED: {
            bg: '#ffc7ce',
            text: '#9c0006'
        }
    };

    // Schedule button selectors
    const SCHEDULE_SELECTORS = {
        SPECIFIC: [
            'button#scheduleButton',
            '.btn.btn-primary[data-omniture-link="Show Schedule"]',
            'button[data-omniture-link="Show Schedule"]',
            '#scheduleButton',
            'button.btn.btn-primary#scheduleButton'
        ],
        GENERIC: [
            'button.btn-primary:contains("Show schedule")',
            'button:contains("Show schedule")',
            '[data-omniture-link*="Schedule"]',
            '[data-testid="schedule-button"]',
            '[aria-label*="schedule"]',
            '[class*="schedule"]',
            'button:contains("Schedule")',
            'a:contains("Schedule")'
        ]
    };

    const XPATH_QUERIES = [
        "//button[@id='scheduleButton']",
        "//button[@data-omniture-link='Show Schedule']",
        "//button[contains(@class, 'btn-primary') and contains(., 'Show schedule')]",
        "//button[contains(translate(., 'SCHEDULE', 'schedule'), 'schedule')]",
        "//*[@data-omniture-link and contains(., 'Schedule')]"
    ];

    // Initialize variables with stored values
    let breakTime = GM_getValue('breakTime', 30);
    let workTime = GM_getValue('workTime', 8);
    let titleFormat = GM_getValue('titleFormat', TITLE_FORMATS.SIMPLE);

    // Utility functions
    function isElementVisible(element) {
        if (!element || !element.offsetParent) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               rect.width > 0 &&
               rect.height > 0 &&
               style.pointerEvents !== 'none';
    }

    function simulateClick(element) {
        try {
            // Try regular click
            element.click();
            return true;
        } catch (e) {
            try {
                // Try mouse events
                ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(eventType => {
                    const event = new MouseEvent(eventType, {
                        view: window,
                        bubbles: true,
                        cancelable: true,
                        buttons: 1
                    });
                    element.dispatchEvent(event);
                });
                return true;
            } catch (e) {
                return false;
            }
        }
    }
    // Time calculation functions
    function findPunchTimes() {
        let punchInTime = null;
        let punchOutTime = null;
        let missingPunch = false;

        console.log("Searching for punch times...");

        // Search in time entries
        const timeEntries = document.querySelectorAll('[data-testid*="time-entry"]');
        timeEntries.forEach(entry => {
            const text = entry.textContent.toLowerCase();
            const timeMatch = text.match(/(\d{1,2}:\d{2})/);
            if (timeMatch) {
                if (text.includes('in') && !punchInTime) {
                    punchInTime = timeMatch[0].padStart(5, '0');
                } else if (text.includes('out') && !punchOutTime) {
                    punchOutTime = timeMatch[0].padStart(5, '0');
                }
            }
        });

        // Alternative search method
        if (!punchInTime || !punchOutTime) {
            const timeCards = document.querySelectorAll('.time-card-entry, .punch-time, [class*="timecard"], [class*="punch"]');
            timeCards.forEach(card => {
                const text = card.textContent.toLowerCase();
                const timeMatch = text.match(/(\d{1,2}:\d{2})/);
                if (timeMatch) {
                    if ((text.includes('in') || text.includes('ein')) && !punchInTime) {
                        punchInTime = timeMatch[0].padStart(5, '0');
                    } else if ((text.includes('out') || text.includes('aus')) && !punchOutTime) {
                        punchOutTime = timeMatch[0].padStart(5, '0');
                    }
                }
            });
        }

        // XPath fallback
        if (!punchInTime || !punchOutTime) {
            const timeNodes = document.evaluate(
                "//*[contains(text(), ':')]",
                document,
                null,
                XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            for (let i = 0; i < timeNodes.snapshotLength; i++) {
                const node = timeNodes.snapshotItem(i);
                const text = node.textContent.trim().toLowerCase();
                const timeMatch = text.match(/(\d{1,2}:\d{2})/);
                if (timeMatch) {
                    const fullContext = node.parentElement?.textContent.toLowerCase() || '';
                    if ((fullContext.includes('in') || fullContext.includes('ein')) && !punchInTime) {
                        punchInTime = timeMatch[0].padStart(5, '0');
                    } else if ((fullContext.includes('out') || fullContext.includes('aus')) && !punchOutTime) {
                        punchOutTime = timeMatch[0].padStart(5, '0');
                    }
                }
            }
        }

        // Check for missing punch
        const pageContent = document.body.textContent.toLowerCase();
        missingPunch = TRANSLATIONS.MISSING.some(term =>
            pageContent.includes(term.toLowerCase())
        );
        if (missingPunch) {
            punchOutTime = null;
        }

        console.log("Final times - In:", punchInTime, "Out:", punchOutTime, "Missing:", missingPunch);
        return { punchInTime, punchOutTime };
    }

    function getCurrentWorktime(startTime, endTime) {
        if (endTime) {
            return getTimeDifference(startTime, endTime);
           }
        const now = new Date();
        const nowHours = now.getHours();
        const nowMinutes = now.getMinutes();
        const [startHours, startMinutes] = startTime.split(':').map(Number);
        let hours = nowHours - startHours;
        let minutes = nowMinutes - startMinutes;
        if (minutes < 0) {
            hours--;
            minutes += 60;
        }
        if (hours < 0) {
            hours += 24;
        }
        return hours + (minutes / 60);
    }

    function getTimeDifference(startTime, endTime) {
        const [startHours, startMinutes] = startTime.split(':').map(Number);
        const [endHours, endMinutes] = endTime.split(':').map(Number);
        let hours = endHours - startHours;
        let minutes = endMinutes - startMinutes;
        if (minutes < 0) {
            hours--;
            minutes += 60;
        }
        if (hours < 0) {
            hours += 24;
        }
        return hours + (minutes / 60);
    }

    function getBackgroundColor(hours) {
        if (hours <= 8.5) return COLORS.GREEN;
        if (hours <= 10) return COLORS.YELLOW;
        return COLORS.RED;
    }

    function calculateEndTime(startTime, workHours, breakMinutes) {
        const [hours, minutes] = startTime.split(':').map(Number);
        let endHours = hours + workHours;
        let endMinutes = minutes + breakMinutes;
        if (endMinutes >= 60) {
            endHours += Math.floor(endMinutes / 60);
            endMinutes = endMinutes % 60;
        }
        if (endHours >= 24) {
            endHours -= 24;
        }
        return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
    }

    function formatHoursAndMinutes(hours) {
        if (isNaN(hours)) return "0:00";
        const fullHours = Math.floor(hours);
        const minutes = Math.round((hours - fullHours) * 60);
        return `${fullHours}h ${minutes.toString().padStart(2, '0')}min`;
    }

    function calculateRemainingTime(punchInTime, workTime, breakTime) {
        const currentWorktime = getCurrentWorktime(punchInTime, null);
        const targetHours = parseFloat(workTime) + (breakTime / 60);
        const remainingHours = targetHours - currentWorktime;
        if (remainingHours <= 0 || isNaN(remainingHours)) {
            return null;
        }
        const hours = Math.floor(remainingHours);
        const minutes = Math.round((remainingHours - hours) * 60);
        return { hours, minutes };
    }
    // UI update functions
    function updatePageTitle(punchInTime, punchOutTime) {
        const originalTitle = "A to Z";
        if (punchOutTime || !punchInTime) {
            document.title = originalTitle;
            return;
        }
        const remaining = calculateRemainingTime(punchInTime, workTime, breakTime);
        if (remaining) {
            const { hours, minutes } = remaining;
            let timeString;
            switch(titleFormat) {
                case TITLE_FORMATS.DETAILED:
                    timeString = `-${hours}:${minutes.toString().padStart(2, '0')} remaining - ${originalTitle}`;
                    break;
                case TITLE_FORMATS.MINIMAL:
                    timeString = `-${hours}:${minutes.toString().padStart(2, '0')} - ${originalTitle}`;
                    break;
                case TITLE_FORMATS.SIMPLE:
                default:
                    timeString = `(-${hours}h ${minutes}m) ${originalTitle}`;
                    break;
            }
            document.title = timeString;
        } else {
            document.title = originalTitle;
        }
    }

    function updateDisplay(punchInTime = null, punchOutTime = null) {
        const display = document.getElementById('timeCalculator');
        if (display) {
            let content;
            const currentTime = new Date().toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            if (punchInTime) {
                const currentWorktime = getCurrentWorktime(punchInTime, punchOutTime);
                const colors = getBackgroundColor(currentWorktime);
                const maxEndTime = calculateEndTime(punchInTime, 10, FIXED_MAX_BREAK);
                display.style.backgroundColor = colors.bg;
                content = `
                    <div style="margin-bottom: 12px; font-weight: bold; color: ${colors.text}; font-size: 20px; text-align: center;"><u>Worked Time Calculator</u></div>
                    <div style="margin-bottom: 8px; color: ${colors.text};">Current Time: <strong>${currentTime}</strong></div>
                    <div style="margin-bottom: 8px; color: ${colors.text};">Badged-In Time: <strong>${punchInTime}</strong></div>
                    ${punchOutTime ? `<div style="margin-bottom: 8px; color: ${colors.text};">Ausstempelzeit: <strong>${punchOutTime}</strong></div>` : ''}
                    <div style="margin-bottom: 8px; color: ${colors.text};">
                        Work Hours:
                        <select id="workTimeSelect" style="margin-left: 5px; background-color: white;">
                            <option value="6" ${workTime === 6 ? 'selected' : ''}>6 Hours</option>
                            <option value="8" ${workTime === 8 ? 'selected' : ''}>8 Hours</option>
                            <option value="9" ${workTime === 9 ? 'selected' : ''}>9 Hours</option>
                            <option value="10" ${workTime === 10 ? 'selected' : ''}>10 Hours</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 8px; color: ${colors.text};">
                        Break Time:
                        <select id="breakTimeSelect" style="margin-left: 5px; background-color: white;">
                            <option value="0" ${breakTime === 0 ? 'selected' : ''}>No Break</option>
                            <option value="30" ${breakTime === 30 ? 'selected' : ''}>30 Minutes</option>
                            <option value="45" ${breakTime === 45 ? 'selected' : ''}>45 Minutes</option>
                            <option value="60" ${breakTime === 60 ? 'selected' : ''}>60 Minutes</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 8px; color: ${colors.text};">
                        Title Format:
                        <select id="titleFormatSelect" style="margin-left: 5px; background-color: white;">
                            <option value="${TITLE_FORMATS.SIMPLE}" ${titleFormat === TITLE_FORMATS.SIMPLE ? 'selected' : ''}>Simple (1h 23m)</option>
                            <option value="${TITLE_FORMATS.DETAILED}" ${titleFormat === TITLE_FORMATS.DETAILED ? 'selected' : ''}>Detailed (1:23 remaining)</option>
                            <option value="${TITLE_FORMATS.MINIMAL}" ${titleFormat === TITLE_FORMATS.MINIMAL ? 'selected' : ''}>Minimal (1:23)</option>
                        </select>
                    </div>
                    ${!punchOutTime ? `
                    <div style="margin-top: 12px; font-weight: bold; color: ${colors.text};">
                        Planned Badge Out: <strong>${calculateEndTime(punchInTime, workTime, breakTime)}</strong>
                    </div>
                    <div style="margin-top: 4px; font-weight: bold; color: red;">
                        Latest Time Allowed: <span style="color: red; font-weight: bold; background-color: #ffdddd; padding: 2px 5px; border-radius: 3px;">❗${maxEndTime}❗</span>
                    </div>
                    ` : ''}
                    <div style="font-size: 12px; color: ${colors.text}; margin-top: 8px;">
                        ${punchOutTime ? 'Gesamte' : 'Actual'} Worked Time: ${formatHoursAndMinutes(currentWorktime)}
                    </div>
                    ${!punchOutTime ? `
                        <div style="font-size: 12px; color: ${colors.text}; margin-top: 4px;">
                            Planned Total Hours: ${workTime}h ${breakTime}min
                        </div>
                        <div style="font-size: 12px; color: ${colors.text}; margin-top: 4px;">
                            Maximum Working Hours: 10h ${FIXED_MAX_BREAK}min
                        </div>
                    ` : ''}
                `;
            } else {
                display.style.backgroundColor = 'white';
                content = `
                    <div style="margin-bottom: 12px; font-weight: bold; color: #666;">Arbeitszeitrechner</div>
                    <div style="margin-bottom: 8px; color: #666;">Aktuelle Zeit: <strong>${currentTime}</strong></div>
                    <div style="margin-bottom: 8px; color: #666;">Badged-In Time: <strong>Keine Stempelzeit gefunden</strong></div>
                    <div style="margin-bottom: 8px; color: #666;">
                        Arbeitszeit:
                        <select id="workTimeSelect" style="margin-left: 5px; background-color: white;">
                            <option value="6" ${workTime === 6 ? 'selected' : ''}>6 Stunden</option>
                            <option value="8" ${workTime === 8 ? 'selected' : ''}>8 Stunden</option>
                            <option value="9" ${workTime === 9 ? 'selected' : ''}>9 Stunden</option>
                            <option value="10" ${workTime === 10 ? 'selected' : ''}>10 Stunden</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 8px; color: #666;">
                        Pausenzeit:
                        <select id="breakTimeSelect" style="margin-left: 5px; background-color: white;">
                            <option value="30" ${breakTime === 30 ? 'selected' : ''}>30 Minuten</option>
                            <option value="45" ${breakTime === 45 ? 'selected' : ''}>45 Minuten</option>
                            <option value="60" ${breakTime === 60 ? 'selected' : ''}>60 Minuten</option>
                        </select>
                    </div>
                    <div style="font-size: 12px; color: #666; margin-top: 8px;">
                        Warte auf Stempelzeit...
                    </div>
                `;
            }
            display.innerHTML = content;

            // Event Listeners
            const breakSelect = document.getElementById('breakTimeSelect');
            if (breakSelect) {
                breakSelect.addEventListener('change', function() {
                    breakTime = parseInt(this.value);
                    GM_setValue('breakTime', breakTime);
                    updateDisplay(punchInTime, punchOutTime);
                });
            }

            const workSelect = document.getElementById('workTimeSelect');
            if (workSelect) {
                workSelect.addEventListener('change', function() {
                    workTime = parseInt(this.value);
                    GM_setValue('workTime', workTime);
                    updateDisplay(punchInTime, punchOutTime);
                });
            }

            const titleFormatSelect = document.getElementById('titleFormatSelect');
            if (titleFormatSelect) {
                titleFormatSelect.addEventListener('change', function() {
                    titleFormat = parseInt(this.value);
                    GM_setValue('titleFormat', titleFormat);
                    updatePageTitle(punchInTime, punchOutTime);
                });
            }

            updatePageTitle(punchInTime, punchOutTime);
        }
    }

    function addTimeCalculator() {
        let display = document.getElementById('timeCalculator');
        if (!display) {
            display = document.createElement('div');
            display.id = 'timeCalculator';
            display.style.cssText = `
                position: fixed;
                bottom: 100px;
                right: 10px;
                padding: 15px;
                border: 1px solid #ccc;
                border-radius: 5px;
                z-index: 9999;
                font-family: Arial, sans-serif;
                font-size: 14px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                min-width: 220px;
                transition: background-color 0.3s ease;
                background-color: white;
            `;
            document.body.appendChild(display);
        }
        const { punchInTime, punchOutTime } = findPunchTimes();
        updateDisplay(punchInTime, punchOutTime);
    }
    // Schedule button functionality
    function clickScheduleButton() {
        // Try CSS selectors first
        for (const selector of [...SCHEDULE_SELECTORS.SPECIFIC, ...SCHEDULE_SELECTORS.GENERIC]) {
            try {
                const elements = document.querySelectorAll(selector);
                console.log(`Found ${elements.length} elements for selector: ${selector}`);

                for (const element of elements) {
                    if (isElementVisible(element)) {
                        console.log('Found clickable element:', selector);
                        if (simulateClick(element)) {
                            console.log('Successfully clicked schedule button');
                            return true;
                        }
                    }
                }
            } catch (e) {
                console.log(`Error with selector ${selector}:`, e);
            }
        }

        // Try XPath as fallback
        for (const xpath of XPATH_QUERIES) {
            try {
                const result = document.evaluate(
                    xpath,
                    document,
                    null,
                    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                    null
                );

                console.log(`Found ${result.snapshotLength} elements for XPath: ${xpath}`);
                for (let i = 0; i < result.snapshotLength; i++) {
                    const element = result.snapshotItem(i);
                    if (isElementVisible(element)) {
                        console.log('Found clickable element with XPath:', xpath);
                        if (simulateClick(element)) {
                            console.log('Successfully clicked schedule button using XPath');
                            return true;
                        }
                    }
                }
            } catch (e) {
                console.log(`Error with XPath ${xpath}:`, e);
            }
        }

        // Additional fallback for dynamic content
        const scheduleLink = Array.from(document.querySelectorAll('a, button, div[role="button"]')).find(
            el => el.textContent.toLowerCase().includes('schedule') ||
                 el.textContent.toLowerCase().includes('show schedule')
        );

        if (scheduleLink && isElementVisible(scheduleLink)) {
            console.log('Found schedule link through text content');
            if (simulateClick(scheduleLink)) {
                console.log('Successfully clicked schedule link');
                return true;
            }
        }

        console.log('No clickable schedule button found');
        return false;
    }

    function attemptScheduleClick() {
        // Initial delay before starting attempts
        setTimeout(() => {
            let attempts = 0;
            const maxAttempts = 10;
            const interval = setInterval(() => {
                if (attempts >= maxAttempts) {
                    console.log('Maximum attempts reached for clicking schedule button');
                    clearInterval(interval);
                    return;
                }

                if (clickScheduleButton()) {
                    console.log('Schedule button clicked successfully');
                    clearInterval(interval);
                    return;
                }

                attempts++;
                console.log(`Attempt ${attempts} to click schedule button`);
            }, 1000);
        }, 2000); // Wait 2 seconds before starting attempts
    }

    // Main initialization function
    function startTimeUpdates() {
        try {
            // Initial run
            addTimeCalculator();

            // Add the schedule button clicking
            attemptScheduleClick();

            // Update calculator every 5 seconds
            const calculatorInterval = setInterval(addTimeCalculator, 5000);

            // Update title more frequently for smoother countdown
            const titleInterval = setInterval(() => {
                const { punchInTime, punchOutTime } = findPunchTimes();
                updatePageTitle(punchInTime, punchOutTime);
            }, 1000);

            // Cleanup function for page unload
            window.addEventListener('unload', () => {
                clearInterval(calculatorInterval);
                clearInterval(titleInterval);
            });

            // Add error handler for the overlay
            window.addEventListener('error', (error) => {
                console.error('Script error:', error);
                // Try to recover the overlay if possible
                try {
                    addTimeCalculator();
                } catch (e) {
                    console.error('Failed to recover overlay:', e);
                }
            });

        } catch (error) {
            console.error('Error in startTimeUpdates:', error);
        }
    }

    // Initial execution with error handling
    setTimeout(() => {
        try {
            startTimeUpdates();
        } catch (error) {
            console.error('Error during initialization:', error);
            // Attempt recovery
            setTimeout(startTimeUpdates, 5000);
        }
    }, 1000);

})();
