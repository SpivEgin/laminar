/* laminar.js
 * frontend application for Laminar Continuous Integration
 * https://laminar.ohwg.net
 */
const WebsocketHandler = function() {
  function setupWebsocket(path, next) {
    var ws = new WebSocket("ws://" + window.location.host + path);
    ws.onmessage = function(msg) {
      msg = JSON.parse(msg.data);
      // "status" is the first message the websocket always delivers.
      // Use this to confirm the navigation. The component is not
      // created until next() is called, so creating a reference
      // for other message types must be deferred
      if (msg.type === 'status') {
        next(comp => {
          // Set up bidirectional reference
          // 1. needed to reference the component for other msg types
          this.comp = comp;
          // 2. needed to close the ws on navigation away
          comp.ws = this;
          // Update html and nav titles
          document.title = comp.$root.title = msg.title;
          // Component-specific callback handler
          comp[msg.type](msg.data);
        });
      } else {
        // at this point, the component must be defined
        if (!this.comp)
          return console.error("Page component was undefined");
        else if (typeof this.comp[msg.type] === 'function')
          this.comp[msg.type](msg.data);
      }
    };
  };
  return {
    beforeRouteEnter(to, from, next) {
      setupWebsocket(to.path, (fn) => { next(fn); });
    },
    beforeRouteUpdate(to, from, next) {
      this.ws.close();
      setupWebsocket(to.path, (fn) => { fn(this); next(); });
    },
    beforeRouteLeave(to, from, next) {
      this.ws.close();
      next();
    },
  };
}();

const Utils = {
  methods: {
    runIcon(result) {
      return result === "success" ? '<span style="color:forestgreen;font-family:\'Zapf Dingbats\';">✔</span>' : result === "failed" || result === "aborted" ? '<span style="color:crimson;">✘</span>' : '';
    },
    formatDate: function(unix) {
      // TODO: reimplement when toLocaleDateString() accepts formatting options on most browsers
      var d = new Date(1000 * unix);
      var m = d.getMinutes();
      if (m < 10) m = '0' + m;
      return d.getHours() + ':' + m + ' on ' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' +
        d.getDate() + '. ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ][d.getMonth()] + ' ' +
        d.getFullYear();
    },
  }
};

const ProgressUpdater = {
  data() { return { jobsRunning: [] }; },
  methods: {
    updateProgress(o) {
      if (o.etc) {
        var p = ((new Date()).getTime() / 1000 - o.started) / (o.etc - o.started);
        if (p > 1.2) {
          o.overtime = true;
        } else if (p >= 1) {
          o.progress = 99;
        } else {
          o.progress = 100 * p;
        }
      }
    }
  },
  beforeDestroy() {
    clearInterval(this.updateTimer);
  },
  watch: {
    jobsRunning(val) {
      // this function handles several cases:
      // - the route has changed to a different run of the same job
      // - the current job has ended
      // - the current job has started (practically hard to reach)
      clearInterval(this.updateTimer);
      if (val.length) {
        // TODO: first, a non-animated progress update
        this.updateTimer = setInterval(() => {
          this.jobsRunning.forEach(this.updateProgress);
          this.$forceUpdate();
        }, 1000);
      }
    }
  }
};

const Home = function() {
  var state = {
    jobsQueued: [],
    jobsRecent: []
  };

  var chtUtilization, chtBuildsPerDay, chtBuildsPerJob, chtTimePerJob;

  var updateUtilization = function(busy) {
    chtUtilization.segments[0].value += busy ? 1 : -1;
    chtUtilization.segments[1].value -= busy ? 1 : -1;
    chtUtilization.update();
  }

  return {
    template: '#home',
    mixins: [WebsocketHandler, Utils, ProgressUpdater],
    data: function() {
      return state;
    },
    methods: {
      status: function(msg) {
        state.jobsQueued = msg.queued;
        state.jobsRunning = msg.running;
        state.jobsRecent = msg.recent;
        this.$forceUpdate();

        // setup charts
        chtUtilization = new Chart(document.getElementById("chartUtil").getContext("2d")).Pie(
          [{
              value: msg.executorsBusy,
              color: "tan",
              label: "Busy"
            },
            {
              value: msg.executorsTotal,
              color: "darkseagreen",
              label: "Idle"
            }
          ], {
            animationEasing: 'easeInOutQuad'
          }
        );
        chtBuildsPerDay = new Chart(document.getElementById("chartBpd").getContext("2d")).Line({
          labels: function() {
            res = [];
            var now = new Date();
            for (var i = 6; i >= 0; --i) {
              var then = new Date(now.getTime() - i * 86400000);
              res.push(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][then.getDay()]);
            }
            return res;
          }(),
          datasets: [{
            label: "Successful Builds",
            fillColor: "darkseagreen",
            strokeColor: "forestgreen",
            data: msg.buildsPerDay.map(function(e) {
              return e.success || 0;
            })
          }, {
            label: "Failed Bulids",
            fillColor: "darksalmon",
            strokeColor: "crimson",
            data: msg.buildsPerDay.map(function(e) {
              return e.failed || 0;
            })
          }]
        }, {
          showTooltips: false
        });
        chtBuildsPerJob = new Chart(document.getElementById("chartBpj").getContext("2d")).HorizontalBar({
          labels: Object.keys(msg.buildsPerJob),
          datasets: [{
            fillColor: "lightsteelblue",
            data: Object.keys(msg.buildsPerJob).map(function(e) {
              return msg.buildsPerJob[e];
            })
          }]
        }, {});
        chtTimePerJob = new Chart(document.getElementById("chartTpj").getContext("2d")).HorizontalBar({
          labels: Object.keys(msg.timePerJob),
          datasets: [{
            fillColor: "lightsteelblue",
            data: Object.keys(msg.timePerJob).map(function(e) {
              return msg.timePerJob[e];
            })
          }]
        }, {});


      },
      job_queued: function(data) {
        state.jobsQueued.splice(0, 0, data);
        this.$forceUpdate();
      },
      job_started: function(data) {
        state.jobsQueued.splice(state.jobsQueued.length - data.queueIndex - 1, 1);
        state.jobsRunning.splice(0, 0, data);
        this.$forceUpdate();
        updateUtilization(true);
      },
      job_completed: function(data) {
        if (data.result === "success")
          chtBuildsPerDay.datasets[0].points[6].value++;
        else
          chtBuildsPerDay.datasets[1].points[6].value++;
        chtBuildsPerDay.update();

        for (var i = 0; i < state.jobsRunning.length; ++i) {
          var job = state.jobsRunning[i];
          if (job.name == data.name && job.number == data.number) {
            state.jobsRunning.splice(i, 1);
            state.jobsRecent.splice(0, 0, data);
            this.$forceUpdate();
            break;
          }
        }
        updateUtilization(false);
        for (var j = 0; j < chtBuildsPerJob.datasets[0].bars.length; ++j) {
          if (chtBuildsPerJob.datasets[0].bars[j].label == job.name) {
            chtBuildsPerJob.datasets[0].bars[j].value++;
            chtBuildsPerJob.update();
            break;
          }
        }
      }
    }
  };
}();

const Jobs = function() {
  var state = {
    jobs: [],
    search: '',
    tags: [],
    tag: null
  };
  return {
    template: '#jobs',
    mixins: [WebsocketHandler, Utils],
    data: function() { return state; },
    computed: {
      filteredJobs() {
        var ret = this.jobs;
        var tag = this.tag;
        if (tag) {
          ret = ret.filter(function(job) {
            return job.tags.indexOf(tag) >= 0;
          });
        }
        var search = this.search;
        if (search) {
          ret = ret.filter(function(job) {
            return job.name.indexOf(search) > -1;
          });
        }
        return ret;
      }
    },
    methods: {
      status: function(msg) {
        state.jobs = msg.jobs;
        var tags = {};
        for (var i in state.jobs) {
          for (var j in state.jobs[i].tags) {
            tags[state.jobs[i].tags[j]] = true;
          }
        }
        state.tags = Object.keys(tags);
      },
      job_completed: function(data) {
        for (var i in state.jobs) {
          if (state.jobs[i].name === data.name) {
            state.jobs[i] = data;
            this.$forceUpdate();
            break;
          }
        }
      }
    }
  };
}();

var Job = function() {
  var state = {
    jobsRunning: [],
    jobsRecent: [],
    lastSuccess: null,
    lastFailed: null,
    nQueued: 0,
  };
  return Vue.extend({
    template: '#job',
    mixins: [WebsocketHandler, Utils],
    data: function() {
      return state;
    },
    methods: {
      status: function(msg) {
        state.jobsRunning = msg.running;
        state.jobsRecent = msg.recent;
        state.lastSuccess = msg.lastSuccess;
        state.lastFailed = msg.lastFailed;

        var chtBt = new Chart(document.getElementById("chartBt").getContext("2d")).Bar({
          labels: msg.recent.map(function(e) {
            return '#' + e.number;
          }).reverse(),
          datasets: [{
            fillColor: "darkseagreen",
            strokeColor: "forestgreen",
            data: msg.recent.map(function(e) {
              return e.duration;
            }).reverse()
          }]
        }, {
          barValueSpacing: 1,
          barStrokeWidth: 1,
          barDatasetSpacing: 0
        });

        for (var i = 0, n = msg.recent.length; i < n; ++i) {
          if (msg.recent[i].result != "success") {
            chtBt.datasets[0].bars[n - i - 1].fillColor = "darksalmon";
            chtBt.datasets[0].bars[n - i - 1].strokeColor = "crimson";
          }
        }
        chtBt.update();

      },
      job_queued: function() {
        state.nQueued++;
      },
      job_started: function(data) {
        state.nQueued--;
        state.jobsRunning.splice(0, 0, data);
        this.$forceUpdate();
      },
      job_completed: function(data) {
        for (var i = 0; i < state.jobsRunning.length; ++i) {
          var job = state.jobsRunning[i];
          if (job.number === data.number) {
            state.jobsRunning.splice(i, 1);
            state.jobsRecent.splice(0, 0, data);
            this.$forceUpdate();
            // TODO: update the chart
            break;
          }
        }
      }
    }
  });
}();

const Run = function() {
  var state = {
    job: { artifacts: [] },
    latestNum: null,
    log: '',
    autoscroll: false
  };
  var firstLog = false;
  var logHandler = function(vm, d) {
    state.log += d;
    vm.$forceUpdate();
    if (!firstLog) {
      firstLog = true;
    } else if (state.autoscroll) {
      window.scrollTo(0, document.body.scrollHeight);
    }
  };

  return {
    template: '#run',
    mixins: [WebsocketHandler, Utils, ProgressUpdater],
    data: function() {
      return state;
    },
    methods: {
      status: function(data) {
        state.log = '';
        state.job = data;
        state.latestNum = data.latestNum;
        if (!!state.job.etc)
          state.jobsRunning = [data];
      },
      job_started: function(data) {
        state.latestNum++;
        this.$forceUpdate();
      },
      job_completed: function(data) {
        state.job = data;
        state.jobsRunning = [];
        this.$forceUpdate();
      },
      runComplete: function(run) {
        return !!run && (run.result === 'aborted' || run.result === 'failed' || run.result === 'success');
      },
    },
    beforeRouteEnter(to, from, next) {
      next(vm => {
        vm.logws = new WebSocket("ws://" + location.host + to.path + '/log');
        vm.logws.onmessage = function(msg) {
          logHandler(vm, msg.data);
        }
      });
    },
    beforeRouteUpdate(to, from, next) {
      var vm = this;
      state.jobsRunning = [];
      vm.logws.close();
      vm.logws = new WebSocket("ws://" + location.host + to.path + '/log');
      vm.logws.onmessage = function(msg) {
        logHandler(vm, msg.data);
      }
      next();
    },
    beforeRouteLeave(to, from, next) {
      this.logws.close();
      next();
    }
  };
}();

new Vue({
  el: '#app',
  data: {
    title: '' // populated by status ws message
  },
  router: new VueRouter({
    mode: 'history',
    routes: [
      { path: '/',                   component: Home },
      { path: '/jobs',               component: Jobs },
      { path: '/jobs/:name',         component: Job },
      { path: '/jobs/:name/:number', component: Run }
    ],
  }),
});
