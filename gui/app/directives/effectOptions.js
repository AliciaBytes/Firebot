(function(){
  
 //This adds the <effect-options> element
 
 const effects = require('../../lib/interactive/effect-manager.js');
 
 angular
   .module('firebotApp')
   .directive('effectOptions', function() {
     return {
       restrict: 'E',
       scope: {
         effect: '=',
         type: '='
       },
       replace: true,
       template: '<div ng-include="templateUrl"></div>',
       link: function($scope, element, attrs) {
           $scope.$watch('type', function() {
             var templateUrlPath = effects.getTemplateFilePathForEffectType($scope.type);
             $scope.templateUrl = templateUrlPath;
           });
       },
       controller: ($scope, listenerService) => {
         
         // We want to locate the controller of the given effect type (if there is one)
         // and run it.
         // Note(ebiggz): I need to figure out a better way to handle dependancy injection
         function findController() {
           var effectController = effects.getTemplateControllerForEffectType($scope.type);
           effectController($scope, listenerService);
         }
         
         // Find controller on initial load.
         findController();
         
         // Find new controller if the user changes the type via the dropdown
         $scope.$watch('type', function() {
           findController();
         });
       }
     }
   });
 })();